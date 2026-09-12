'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Business, Order, Delivery, Product, CoverageZone } from '@/types'
import { db } from '@/lib/firebase'
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, Timestamp, getDocs } from 'firebase/firestore'
import {
    getBusiness,
    getProductsByBusiness,
    deleteOrder,
    getCoverageZones,
    isPointInPolygon,
    getDeliveriesByStatus,
    updateOrderStatus,
    updateBusiness,
    getTodayVisitsDocRef,
    getOrdersByBusinessPaginated,
    getAllBusinesses,
    getProductsByIds
} from '@/lib/database'
import {
    sendWhatsAppToDelivery,
    sendWhatsAppToCustomer,
    sendOrderToStore,
    getNextStatus
} from '@/components/WhatsAppUtils'
import { isStoreOpen, calculateManualStatusExpiry } from '@/lib/store-utils'
import QueueStatusIndicator from '@/components/QueueStatusIndicator'
import NotificationsBell from '@/components/NotificationsBell'
import CierreSidebarView from '@/components/CierreSidebarView'
import ReportesSidebarView from '@/components/ReportesSidebarView'
import TransferenciasSidebarView from '@/components/TransferenciasSidebarView'
import DailyCheckInBanner from '@/components/DailyCheckInBanner'

import { useOfflineQueue } from '@/hooks/useOfflineQueue'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'
import { logDebug } from '@/lib/debug-log'

import type { CheckoutSession } from '@/components/LiveCheckoutsPanel'

import OrderStatusColumn from '@/components/pedidos/OrderStatusColumn'
import CustomerContactModal from '@/components/pedidos/CustomerContactModal'
import DeliveryStatusModal from '@/components/pedidos/DeliveryStatusModal'

// Lazy-loaded SPA components
const PaymentManagementModals = dynamic(() => import('@/components/PaymentManagementModals'), { ssr: false })
const ManualOrderSidebar = dynamic(() => import('@/components/ManualOrderSidebar'), { ssr: false })
const LiveCheckoutsPanel = dynamic(() => import('@/components/LiveCheckoutsPanel').then(m => m.LiveCheckoutsPanel), { ssr: false })
const OrderHistory = dynamic(() => import('@/components/OrderHistory'), {
    loading: () => (
        <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
        </div>
    ),
    ssr: false
})



const getStatusText = (status: string) => {
    switch (status) {
        case 'pending': return 'Pendiente'
        case 'borrador': return 'Borrador'
        case 'confirmed': return 'Confirmado'
        case 'preparing': return 'Preparando'
        case 'ready': return 'Listo para entrega'
        case 'on_way': return 'En camino'
        case 'delivered': return 'Entregado'
        case 'cancelled': return 'Descartado'
        default: return status
    }
}

const getStatusColor = (status: string) => {
    switch (status) {
        case 'pending': return 'bg-yellow-100 text-yellow-800'
        case 'borrador': return 'bg-orange-100 text-orange-800'
        case 'confirmed': return 'bg-blue-100 text-blue-800'
        case 'preparing': return 'bg-purple-100 text-purple-800'
        case 'ready': return 'bg-green-100 text-green-800'
        case 'on_way': return 'bg-indigo-100 text-indigo-800'
        case 'delivered': return 'bg-gray-100 text-gray-800'
        case 'cancelled': return 'bg-red-100 text-red-800'
        default: return 'bg-gray-100 text-gray-800'
    }
}

// Helper to convert Firestore timestamp to Date
const toSafeDate = (val: any): Date => {
    if (!val) return new Date()
    if (val instanceof Timestamp) return val.toDate()
    if (typeof val.toDate === 'function') return val.toDate()
    if (val.seconds) return new Date(val.seconds * 1000)
    if (typeof val === 'string') {
        const dateOnlyMatch = val.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (dateOnlyMatch) {
            const [, year, month, day] = dateOnlyMatch
            return new Date(Number(year), Number(month) - 1, Number(day))
        }
        return new Date(val)
    }
    if (val instanceof Date) return val
    return new Date()
}

const toLocalDateInputValue = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

// Helper to get the display time for an order
const getOrderDisplayTime = (order: Order) => {
    try {
        if (order.timing?.scheduledTime) {
            return order.timing.scheduledTime;
        }
        const date = toSafeDate(order.createdAt);
        return date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '--:--';
    }
}

const isActiveDashboardOrder = (order: Order) =>
    ['borrador', 'pending', 'confirmed', 'preparing', 'ready', 'on_way'].includes(order.status)

const getOrderReferenceDateForBadge = (order: Order) =>
    order.timing?.type === 'scheduled' && order.timing.scheduledDate
        ? toSafeDate(order.timing.scheduledDate)
        : toSafeDate(order.createdAt)

const isPreviousActiveOrder = (order: Order) => {
    if (!isActiveDashboardOrder(order)) return false

    const today = new Date()
    const orderDate = getOrderReferenceDateForBadge(order)

    return orderDate.getFullYear() !== today.getFullYear()
        || orderDate.getMonth() !== today.getMonth()
        || orderDate.getDate() !== today.getDate()
}

const getConfiguredDeliveryTime = (business?: Business | null) => {
    return business?.defaultDeliveryTime ?? business?.deliveryTime ?? 30
}

// Auto-assign logic
const autoAssignDeliveryForOrder = async (order: Order, businessOrDeliveryId?: Business | string): Promise<string | undefined> => {
    try {
        const deliveries = await getDeliveriesByStatus('activo');
        let assignedDeliveryId: string | undefined = undefined;

        const businessObj = typeof businessOrDeliveryId === 'object' ? businessOrDeliveryId : undefined;
        let defaultDeliveryId = typeof businessOrDeliveryId === 'string' ? businessOrDeliveryId : businessObj?.defaultDeliveryId;

        // 1. Verificar si la ubicación del pedido cae en una zona con repartidor asignado por la tienda
        const latlong = order.delivery?.latlong;
        let matchingZone: CoverageZone | undefined = undefined;

        if (latlong && !latlong.startsWith('pluscode:')) {
            const [lat, lng] = latlong.split(',').map(Number);
            if (!isNaN(lat) && !isNaN(lng)) {
                const zones = await getCoverageZones();
                matchingZone = zones.find(zone =>
                    zone.isActive &&
                    isPointInPolygon({ lat, lng }, zone.polygon)
                );

                // Si la tienda configuró un repartidor específico para esta zona:
                if (matchingZone && businessObj?.deliveryZoneSettings?.zones?.[matchingZone.id]?.defaultDeliveryId) {
                    const zoneSpecificDeliveryId = businessObj.deliveryZoneSettings.zones[matchingZone.id].defaultDeliveryId;
                    const zoneDriver = deliveries.find(d => d.id === zoneSpecificDeliveryId);
                    if (zoneDriver) {
                        console.log(`[AutoAssign] Using zone-specific default delivery for ${matchingZone.name}:`, zoneSpecificDeliveryId);
                        return zoneDriver.id;
                    }
                }
            }
        }

        // 2. Si no hay repartidor por zona, usar el repartidor predeterminado general de la tienda
        if (defaultDeliveryId) {
            const defaultDelivery = deliveries.find(d => d.id === defaultDeliveryId);
            if (defaultDelivery) {
                console.log('[AutoAssign] Using store general default delivery:', defaultDeliveryId);
                return defaultDelivery.id;
            }
        }

        // 3. Repartidor asignado a nivel global en la zona
        if (matchingZone?.assignedDeliveryId) {
            const zoneDelivery = deliveries.find(d => d.id === matchingZone.assignedDeliveryId);
            if (zoneDelivery) {
                assignedDeliveryId = zoneDelivery.id;
            }
        }

        // 4. Fallbacks
        if (!assignedDeliveryId) {
            const pedroDelivery = deliveries.find(d => d.celular === '0990815097');
            if (pedroDelivery) {
                assignedDeliveryId = pedroDelivery.id;
            } else {
                const sergioDelivery = deliveries.find(d => d.celular === '0978697867');
                if (sergioDelivery) {
                    assignedDeliveryId = sergioDelivery.id;
                }
            }
        }

        return assignedDeliveryId;
    } catch (error) {
        console.error('Error in autoAssign:', error);
        return undefined;
    }
}

export default function AdminPedidosPage() {
    const router = useRouter()
    
    // Admin Auth State
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [authLoading, setAuthLoading] = useState(true)

    // Store Picker State
    const [businesses, setBusinesses] = useState<Business[]>([])
    const [businessesLoading, setBusinessesLoading] = useState(true)
    const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>('all')
    const [showBusinessDropdown, setShowBusinessDropdown] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const businessDropdownRef = useRef<HTMLDivElement>(null)

    // Store details and status
    const [business, setBusiness] = useState<Business | null>(null)
    const [showTimeDropdown, setShowTimeDropdown] = useState(false)
    const [updatingStoreStatus, setUpdatingStoreStatus] = useState(false)
    const [updatingDeliveryTime, setUpdatingDeliveryTime] = useState(false)
    const [checkoutCount, setCheckoutCount] = useState(0)
    const [printMode, setPrintMode] = useState<'standard' | 'bluetooth'>('standard')
    const { queueStatus, retryFailed } = useOfflineQueue()
    const timeDropdownRef = useRef<HTMLDivElement>(null)

    // Notifications Hook
    const pushNotifications = usePushNotifications()
    const {
        requestPermission = () => Promise.resolve('default'),
        isIOS = false,
        needsUserAction = false
    } = pushNotifications || {} as any

    // Tab state
    const [ordersSubTab, setOrdersSubTab] = useState<'today' | 'history'>('today')
    const [summaryExpanded, setSummaryExpanded] = useState(false)

    // Active orders & history lists
    const [orders, setOrders] = useState<Order[]>([])
    const [loading, setLoading] = useState(true)
    const [availableDeliveries, setAvailableDeliveries] = useState<Delivery[]>([])
    const [products, setProducts] = useState<Product[]>([])
    const [toast, setToast] = useState<{ show: boolean; message: string; icon?: string } | null>(null)

    const showToastMessage = (message: string, icon: string = 'bi-printer') => {
        setToast({ show: true, message, icon })
        setTimeout(() => {
            setToast(null)
        }, 2500)
    }

    const [historicalOrders, setHistoricalOrders] = useState<Order[]>([])
    const [allUpcomingOrders, setAllUpcomingOrders] = useState<Order[]>([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [historyLoaded, setHistoryLoaded] = useState(false)
    const [lastHistoryDoc, setLastHistoryDoc] = useState<any>(null)
    const [hasMoreHistory, setHasMoreHistory] = useState(true)

    // Modal state
    const [paymentModalOpen, setPaymentModalOpen] = useState(false)
    const [selectedOrderForPayment, setSelectedOrderForPayment] = useState<Order | null>(null)

    const [deliveryStatusModalOpen, setDeliveryStatusModalOpen] = useState(false)
    const [selectedOrderForStatusModal, setSelectedOrderForStatusModal] = useState<Order | null>(null)

    const [manualOrderSidebarOpen, setManualOrderSidebarOpen] = useState(false)
    const [manualSidebarMode, setManualSidebarMode] = useState<'create' | 'edit'>('create')
    const [selectedOrderForEdit, setSelectedOrderForEdit] = useState<Order | null>(null)

    const [customerContactModalOpen, setCustomerContactModalOpen] = useState(false)
    const [selectedOrderForCustomerContact, setSelectedOrderForCustomerContact] = useState<Order | null>(null)
    const [clientsWithNotes, setClientsWithNotes] = useState<Record<string, string>>({})

    // Menu Sidebar states
    const [isMenuSidebarOpen, setIsMenuSidebarOpen] = useState(false)
    const [activeSidebarTab, setActiveSidebarTab] = useState<'menu' | 'cierre' | 'reportes' | 'transferencias'>('menu')
    const [pendingTransfersCount, setPendingTransfersCount] = useState<number>(0)

    // Cargar la cantidad de transferencias pendientes (on-demand, no real-time)
    useEffect(() => {
        if (!isAuthenticated) return

        const loadTransferCount = async () => {
            try {
                const now = new Date()
                const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0)

                const q = (selectedBusinessId === 'all' || !selectedBusinessId)
                    ? query(
                        collection(db, 'orders'),
                        where('createdAt', '>=', Timestamp.fromDate(startDate))
                      )
                    : query(
                        collection(db, 'orders'),
                        where('businessId', '==', selectedBusinessId),
                        where('createdAt', '>=', Timestamp.fromDate(startDate))
                      )

                const snapshot = await getDocs(q)
                let count = 0
                snapshot.docs.forEach(docSnap => {
                    const o = docSnap.data() as Order
                    if (o.status === 'cancelled' || o.status === 'borrador') return
                    const isTransfer = o.payment?.method === 'transfer' || 
                        (o.payment?.method === 'mixed' && (o.payment.transferAmount || 0) > 0)
                    if (isTransfer && o.payment?.paymentStatus !== 'paid') {
                        count++
                    }
                })
                setPendingTransfersCount(count)
            } catch (err) {
                console.error("Error al contar transferencias pendientes:", err)
            }
        }
        loadTransferCount()
    }, [selectedBusinessId, isAuthenticated])

    const [pendingCierreCount, setPendingCierreCount] = useState<number>(0)

    // Cargar la cantidad de cierres pendientes (on-demand, no real-time)
    useEffect(() => {
        if (!isAuthenticated) return

        const loadCierreCount = async () => {
            try {
                const now = new Date()
                const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0)

                const q = (selectedBusinessId === 'all' || !selectedBusinessId)
                    ? query(
                        collection(db, 'orders'),
                        where('createdAt', '>=', Timestamp.fromDate(startDate))
                      )
                    : query(
                        collection(db, 'orders'),
                        where('businessId', '==', selectedBusinessId),
                        where('createdAt', '>=', Timestamp.fromDate(startDate))
                      )

                const snapshot = await getDocs(q)
                const pendingStores = new Set<string>()
                const pendingDeliveryDays = new Set<string>()

                snapshot.docs.forEach(docSnap => {
                    const o = docSnap.data() as Order
                    if (o.status === 'cancelled' || o.status === 'borrador') return

                    // Restaurantes pendientes
                    if (o.settlementStatus !== 'settled') {
                        if (o.businessId) pendingStores.add(o.businessId)
                    }

                    // Delivery pendientes (solo hoy y días pasados)
                    if (o.delivery?.type === 'delivery' && o.deliverySettlementStatus !== 'settled') {
                        const refDate = toSafeDate(o.timing?.scheduledDate || o.createdAt)
                        const dateStr = toLocalDateInputValue(refDate)
                        const todayStr = toLocalDateInputValue(new Date())
                        if (dateStr <= todayStr) {
                            pendingDeliveryDays.add(dateStr)
                        }
                    }
                })

                setPendingCierreCount(pendingStores.size + pendingDeliveryDays.size)
            } catch (err) {
                console.error("Error al contar cierres pendientes:", err)
            }
        }
        loadCierreCount()
    }, [selectedBusinessId, isAuthenticated])

    const mergedHistoryOrders = useMemo(() => {
        const seen = new Set<string>()
        const merged: Order[] = []
        
        allUpcomingOrders.forEach(o => {
            if (!seen.has(o.id)) {
                seen.add(o.id)
                merged.push(o)
            }
        })
        
        historicalOrders.forEach(o => {
            if (!seen.has(o.id)) {
                seen.add(o.id)
                merged.push(o)
            }
        })
        
        return merged
    }, [allUpcomingOrders, historicalOrders])

    const totalTodaySales = useMemo(() => {
        return orders.reduce((acc, order) => {
            if (order.status === 'cancelled') return acc
            
            if (order.items && order.items.length > 0) {
                const calculatedStoreTotal = order.items.reduce((sum, item) => {
                    const price = item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0))
                    return sum + (price * (item.quantity || 1))
                }, 0)
                return acc + calculatedStoreTotal
            }
            
            if (typeof order.subtotal === 'number') return acc + order.subtotal
            return acc + (order.total || 0)
        }, 0)
    }, [orders])

    const totalTodayPublicSales = useMemo(() => {
        return orders.reduce((acc, order) => {
            if (order.status === 'cancelled') return acc
            return acc + (order.total || 0)
        }, 0)
    }, [orders])

    // 1. Password Verification (consistent with /admin)
    useEffect(() => {
        const checkAdminAuth = () => {
            const adminAuth = localStorage.getItem('adminAuth')
            if (adminAuth === 'authenticated') {
                setIsAuthenticated(true)
                setAuthLoading(false)
            } else {
                const password = prompt('Contraseña de administrador:')
                if (password === 'admin123') {
                    localStorage.setItem('adminAuth', 'authenticated')
                    setIsAuthenticated(true)
                    setAuthLoading(false)
                } else {
                    router.push('/')
                }
            }
        }
        checkAdminAuth()
    }, [router])

    // 2. Load all businesses once authenticated
    useEffect(() => {
        if (!isAuthenticated) return
        const loadAllStores = async () => {
            setBusinessesLoading(true)
            try {
                const all = await getAllBusinesses()
                const active = all.filter(b => !b.isHidden)
                active.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                setBusinesses(active)

                // Select default
                const savedId = localStorage.getItem('adminSelectedBusinessId')
                const currentId = (savedId === 'all' || !savedId) ? 'all' : (active.find(b => b.id === savedId)?.id || 'all')
                setSelectedBusinessId(currentId)
            } catch (err) {
                console.error("Error fetching businesses", err)
            } finally {
                setBusinessesLoading(false)
            }
        }
        loadAllStores()
    }, [isAuthenticated])

    const handleBusinessChange = (id: string) => {
        setSelectedBusinessId(id)
        localStorage.setItem('adminSelectedBusinessId', id)
    }

    // Filter businesses for custom dropdown search
    const filteredBusinesses = useMemo(() => {
        return businesses.filter(b =>
            (b.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            (b.username || '').toLowerCase().includes(searchQuery.toLowerCase())
        )
    }, [businesses, searchQuery])

    // 3. Listen to selected business details in real-time
    useEffect(() => {
        if (!selectedBusinessId) return
        if (selectedBusinessId === 'all') {
            setBusiness(null)
            return
        }
        const unsub = onSnapshot(doc(db, 'businesses', selectedBusinessId), (docSnap) => {
            if (docSnap.exists()) {
                setBusiness({ id: docSnap.id, ...docSnap.data() } as Business)
            }
        }, (err) => {
            console.error("Error listening to business:", err)
        })
        return () => unsub()
    }, [selectedBusinessId])

    // 4. Load available deliveries
    useEffect(() => {
        const fetchDeliveries = async () => {
            try {
                const deliveries = await getDeliveriesByStatus('activo')
                setAvailableDeliveries(deliveries)
            } catch (error) {
                console.error("Error fetching deliveries", error)
            }
        }
        fetchDeliveries()
    }, [])

    // 5. Load products when business changes
    useEffect(() => {
        if (!selectedBusinessId) return
        if (selectedBusinessId === 'all') {
            setProducts([])
            return
        }
        const fetchProducts = async () => {
            try {
                let productsData = await getProductsByBusiness(selectedBusinessId)
                
                // Cargar también productos compartidos (usa cache de businesses ya cargados)
                try {
                    const biz = await getBusiness(selectedBusinessId)
                    if (biz?.sharedProductIds && biz.sharedProductIds.length > 0) {
                        const sharedProducts = await getProductsByIds(biz.sharedProductIds)
                        // Reusar el array de businesses del estado en lugar de llamar getAllBusinesses() de nuevo
                        const allBizs = businesses.length > 0 ? businesses : await getAllBusinesses()
                        const availableShared = sharedProducts
                            .filter(p => {
                                if (!p.isAvailable) return false
                                const ownerBiz = allBizs.find(b => b.id === p.businessId)
                                if (!ownerBiz) return false
                                if (ownerBiz.isActive === false) return false
                                return isStoreOpen(ownerBiz)
                            })
                            .map(p => {
                                const ownerBiz = allBizs.find(b => b.id === p.businessId)
                                return {
                                    ...p,
                                    category: 'Compartidos', // Forzar categoría Compartidos
                                    isShared: true,
                                    originalBusinessId: p.businessId,
                                    originalBusinessName: ownerBiz?.name || 'Otra tienda',
                                    originalBusinessImage: ownerBiz?.image || null
                                }
                            })
                        productsData = [...productsData, ...availableShared]
                    }
                } catch (e) {
                    console.error("Error loading shared products in pedidos dashboard:", e)
                }

                setProducts(productsData)
            } catch (error) {
                console.error("Error fetching products", error)
            }
        }
        fetchProducts()
    }, [selectedBusinessId])

    // 6. Real-time orders listener for the selected business
    const isFirstOrdersLoad = useRef(true)

    const playNotificationSound = () => {
        try {
            const audio = new Audio('/notification-sound.mp3')
            audio.play().catch(e => console.log("Autoplay blocked or error:", e))
        } catch (e) {
            console.error("Error playing sound:", e)
        }
    }

    useEffect(() => {
        if (!selectedBusinessId) return

        setLoading(true)
        isFirstOrdersLoad.current = true

        const now = new Date()
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

        const ordersMap = new Map<string, Order>()
        let activeQueryLoaded = false
        let createdQueryLoaded = false
        let scheduledQueryLoaded = false

        const isActiveOrder = (order: Order) => ['borrador', 'pending', 'confirmed', 'preparing', 'ready', 'on_way'].includes(order.status)
        const isScheduledOrder = (order: Order) => order.timing?.type === 'scheduled' && Boolean(order.timing.scheduledDate)
        const getOrderReferenceDate = (order: Order) => order.timing?.type === 'scheduled' && order.timing.scheduledDate
            ? toSafeDate(order.timing.scheduledDate)
            : toSafeDate(order.createdAt)
        const isOrderForToday = (order: Order) => {
            const orderDate = getOrderReferenceDate(order)
            return orderDate >= startOfDay && orderDate < endOfDay
        }
        const shouldShowInTodayOrders = (order: Order) => {
            if (isScheduledOrder(order)) return isOrderForToday(order)
            return isActiveOrder(order) || isOrderForToday(order)
        }

        const updateOrdersState = () => {
            const allMergedOrders = Array.from(ordersMap.values())
            const todayOrders = allMergedOrders.filter(shouldShowInTodayOrders)

            todayOrders.sort((a, b) => {
                const getMinutes = (o: Order) => {
                    if (o.timing?.type === 'scheduled' && o.timing.scheduledTime) {
                        const [h, m] = o.timing.scheduledTime.split(':').map(Number);
                        return h * 60 + m;
                    }
                    const date = toSafeDate(o.createdAt);
                    return date.getHours() * 60 + date.getMinutes();
                };
                return getMinutes(a) - getMinutes(b);
            });

            setOrders(todayOrders)
            
            // Carga progresiva: mostrar UI en cuanto CUALQUIER listener responda
            if (activeQueryLoaded || createdQueryLoaded || scheduledQueryLoaded) {
                setLoading(false)
            }
        }

        const handleDocChanges = (snapshot: any) => {
            if (!isFirstOrdersLoad.current) {
                snapshot.docChanges().forEach((change: any) => {
                    if (change.type === 'added') {
                        const orderData = change.doc.data() as Order
                        if (shouldShowInTodayOrders(orderData)) {
                            playNotificationSound()
                        }
                    }
                })
            }
        }

        // Listener 1: Orders created today
        const qCreatedToday = selectedBusinessId === 'all'
            ? query(
                collection(db, 'orders'),
                where('createdAt', '>=', Timestamp.fromDate(startOfDay)),
                where('createdAt', '<', Timestamp.fromDate(endOfDay))
            )
            : query(
                collection(db, 'orders'),
                where('businessId', '==', selectedBusinessId),
                where('createdAt', '>=', Timestamp.fromDate(startOfDay)),
                where('createdAt', '<', Timestamp.fromDate(endOfDay))
            )
        const unsubCreated = onSnapshot(qCreatedToday, (snapshot) => {
            handleDocChanges(snapshot)
            snapshot.docs.forEach(doc => {
                ordersMap.set(doc.id, { id: doc.id, ...doc.data() } as Order)
            })
            snapshot.docChanges().forEach(change => {
                if (change.type === 'removed') {
                    const orderData = change.doc.data() as Order
                    if (!isActiveOrder(orderData)) {
                        ordersMap.delete(change.doc.id)
                    }
                }
            })
            createdQueryLoaded = true
            updateOrdersState()
        }, (error) => {
            console.error("Error in unsubCreated:", error)
            createdQueryLoaded = true
            updateOrdersState()
        })

        // Listener 2: Active orders from any time
        const qActive = selectedBusinessId === 'all'
            ? query(
                collection(db, 'orders'),
                where('status', 'in', ['borrador', 'pending', 'confirmed', 'preparing', 'ready', 'on_way'])
            )
            : query(
                collection(db, 'orders'),
                where('businessId', '==', selectedBusinessId),
                where('status', 'in', ['borrador', 'pending', 'confirmed', 'preparing', 'ready', 'on_way'])
            )
        const unsubActive = onSnapshot(qActive, (snapshot) => {
            handleDocChanges(snapshot)
            snapshot.docs.forEach(doc => {
                ordersMap.set(doc.id, { id: doc.id, ...doc.data() } as Order)
            })
            snapshot.docChanges().forEach(change => {
                if (change.type === 'removed') {
                    const orderData = change.doc.data() as Order
                    if (!isOrderForToday(orderData)) {
                        ordersMap.delete(change.doc.id)
                    }
                }
            })
            activeQueryLoaded = true
            updateOrdersState()
        }, (error) => {
            console.error("Error in unsubActive:", error)
            activeQueryLoaded = true
            updateOrdersState()
        })

        // Listener 3: Scheduled orders for today (unificado Timestamp + String)
        // Usa query de Timestamp que cubre ambos formatos en el ordersMap
        const todayString = toLocalDateInputValue(startOfDay)
        const tomorrowString = toLocalDateInputValue(endOfDay)

        const handleScheduledSnapshot = (snapshot: any) => {
            handleDocChanges(snapshot)
            snapshot.docs.forEach((doc: any) => {
                ordersMap.set(doc.id, { id: doc.id, ...doc.data() } as Order)
            })
            snapshot.docChanges().forEach((change: any) => {
                if (change.type === 'removed') {
                    const orderData = change.doc.data() as Order
                    const isActive = isActiveOrder(orderData)
                    const orderDate = toSafeDate(orderData.createdAt)
                    const isCreatedToday = orderDate >= startOfDay && orderDate < endOfDay
                    if (!isActive && !isCreatedToday) {
                        ordersMap.delete(change.doc.id)
                    }
                }
            })
            scheduledQueryLoaded = true
            updateOrdersState()
        }
        const handleScheduledError = (error: any) => {
            console.error("Error in unsubScheduled:", error)
            scheduledQueryLoaded = true
            updateOrdersState()
        }

        // Query por Timestamp
        const qScheduledTimestamp = selectedBusinessId === 'all'
            ? query(
                collection(db, 'orders'),
                where('timing.scheduledDate', '>=', Timestamp.fromDate(startOfDay)),
                where('timing.scheduledDate', '<', Timestamp.fromDate(endOfDay))
            )
            : query(
                collection(db, 'orders'),
                where('businessId', '==', selectedBusinessId),
                where('timing.type', '==', 'scheduled'),
                where('timing.scheduledDate', '>=', Timestamp.fromDate(startOfDay)),
                where('timing.scheduledDate', '<', Timestamp.fromDate(endOfDay))
            )
        const unsubScheduledTimestamp = onSnapshot(qScheduledTimestamp, handleScheduledSnapshot, handleScheduledError)

        // Query por String (legacy) — comparte el mismo handler, el ordersMap deduplica por ID
        const qScheduledString = selectedBusinessId === 'all'
            ? query(
                collection(db, 'orders'),
                where('timing.scheduledDate', '>=', todayString),
                where('timing.scheduledDate', '<', tomorrowString)
            )
            : query(
                collection(db, 'orders'),
                where('businessId', '==', selectedBusinessId),
                where('timing.type', '==', 'scheduled'),
                where('timing.scheduledDate', '>=', todayString),
                where('timing.scheduledDate', '<', tomorrowString)
            )
        const unsubScheduledString = onSnapshot(qScheduledString, handleScheduledSnapshot, handleScheduledError)

        // Marcar fin de primera carga después de un breve delay para agrupar las respuestas iniciales
        const checkFirstLoad = setTimeout(() => {
            isFirstOrdersLoad.current = false
        }, 3000)

        return () => {
            unsubCreated()
            unsubActive()
            unsubScheduledTimestamp()
            unsubScheduledString()
            clearTimeout(checkFirstLoad)
        }
    }, [selectedBusinessId])

    // 7. Fetch all upcoming orders (future scheduled)
    useEffect(() => {
        if (!selectedBusinessId) return

        const now = new Date()
        const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

        const q = selectedBusinessId === 'all'
            ? query(
                collection(db, 'orders'),
                where('timing.scheduledDate', '>=', Timestamp.fromDate(startOfTomorrow)),
                orderBy('timing.scheduledDate', 'asc')
            )
            : query(
                collection(db, 'orders'),
                where('businessId', '==', selectedBusinessId),
                where('timing.type', '==', 'scheduled'),
                where('timing.scheduledDate', '>=', Timestamp.fromDate(startOfTomorrow)),
                orderBy('timing.scheduledDate', 'asc')
            )

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Order[]
            setAllUpcomingOrders(data)
        }, (error) => {
            console.error("Error fetching upcoming orders:", error)
        })

        return () => unsubscribe()
    }, [selectedBusinessId])

    // 8. Load History paginated function
    const loadHistory = async () => {
        if (!selectedBusinessId || historyLoading || (historyLoaded && !hasMoreHistory)) return
        setHistoryLoading(true)
        try {
            const { orders: data, lastDoc } = await getOrdersByBusinessPaginated(selectedBusinessId, 20, lastHistoryDoc)
            setHistoricalOrders(prev => {
                const existingIds = new Set(prev.map(o => o.id))
                const newOrders = data.filter(o => !existingIds.has(o.id))
                return [...prev, ...newOrders]
            })
            setLastHistoryDoc(lastDoc)
            if (data.length < 20) {
                setHasMoreHistory(false)
            }
            setHistoryLoaded(true)
        } catch (error) {
            console.error("Error loading history", error)
        } finally {
            setHistoryLoading(false)
        }
    }

    // Reset history when business changes
    useEffect(() => {
        setHistoricalOrders([])
        setAllUpcomingOrders([])
        setLastHistoryDoc(null)
        setHasMoreHistory(true)
        setHistoryLoaded(false)
    }, [selectedBusinessId])

    useEffect(() => {
        if (ordersSubTab === 'history' || (!loading && orders.length === 0)) {
            loadHistory()
        }
    }, [ordersSubTab, selectedBusinessId, loading, orders.length])

    // 9. Load visits count
    const [visitsCount, setVisitsCount] = useState(0)
    useEffect(() => {
        if (!selectedBusinessId) return

        const visitRef = getTodayVisitsDocRef(selectedBusinessId)
        const unsubscribe = onSnapshot(visitRef, (docSnap) => {
            if (docSnap.exists()) {
                setVisitsCount(docSnap.data().count || 0)
            } else {
                setVisitsCount(0)
            }
        }, (error) => {
            console.error("Error listening to visits:", error)
        })

        return () => unsubscribe()
    }, [selectedBusinessId])

    // Load customer notes cache
    useEffect(() => {
        const fetchNotesForCustomers = async () => {
            const allOrdersList = [...orders, ...allUpcomingOrders]
            if (allOrdersList.length === 0) return
            const { searchClientByPhone } = await import('@/lib/database')
            
            const phones = Array.from(new Set(
                allOrdersList
                    .map(o => o.customer?.phone)
                    .filter((phone): phone is string => !!phone && phone.trim().length >= 9)
            ))

            const newPhones = phones.filter(phone => clientsWithNotes[phone] === undefined)
            if (newPhones.length === 0) return

            const provisionalNotes: Record<string, string> = {}
            for (const phone of newPhones) {
                provisionalNotes[phone] = ''
            }
            setClientsWithNotes(prev => ({ ...prev, ...provisionalNotes }))

            try {
                const results = await Promise.all(
                    newPhones.map(async (phone) => {
                        try {
                            const client = await searchClientByPhone(phone)
                            return { phone, notas: client?.notas || '' }
                        } catch (error) {
                            return { phone, notas: '' }
                        }
                    })
                )

                const finalNotes: Record<string, string> = {}
                for (const r of results) {
                    if (r.notas) {
                        finalNotes[r.phone] = r.notas
                    }
                }
                
                if (Object.keys(finalNotes).length > 0) {
                    setClientsWithNotes(prev => ({ ...prev, ...finalNotes }))
                }
            } catch (error) {
                console.error("Error fetching notes in parallel:", error)
            }
        }

        fetchNotesForCustomers()
    }, [orders, allUpcomingOrders])

    // Reset notes cache when manual order sidebar closes
    useEffect(() => {
        if (!manualOrderSidebarOpen) {
            setClientsWithNotes({})
        }
    }, [manualOrderSidebarOpen])

    // Click outside event listeners for dropdowns
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (businessDropdownRef.current && !businessDropdownRef.current.contains(event.target as Node)) {
                setShowBusinessDropdown(false)
            }
            if (timeDropdownRef.current && !timeDropdownRef.current.contains(event.target as Node)) {
                setShowTimeDropdown(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // State helper variables for rendering columns
    const showCol1 = useMemo(() => orders.some(o => ['borrador', 'pending'].includes(o.status)) || checkoutCount > 0, [orders, checkoutCount]);
    const showCol2 = useMemo(() => orders.some(o => o.status === 'confirmed'), [orders]);
    const showCol3 = useMemo(() => orders.some(o => ['preparing', 'ready', 'on_way', 'delivered', 'cancelled'].includes(o.status)), [orders]);
    
    const configuredDeliveryTime = getConfiguredDeliveryTime(business)
    const currentDeliveryTime = business?.deliveryTime ?? configuredDeliveryTime
    const isDeliveryTimeExtended = currentDeliveryTime > configuredDeliveryTime

    // Action updates helpers
    const updateOrderEverywhere = (updatedOrder: Order) => {
        const replaceOrder = (order: Order) => order.id === updatedOrder.id ? updatedOrder : order
        setOrders(prev => prev.map(replaceOrder))
        setHistoricalOrders(prev => prev.map(replaceOrder))
        setAllUpcomingOrders(prev => prev.map(replaceOrder))
        setSelectedOrderForPayment(prev => prev?.id === updatedOrder.id ? updatedOrder : prev)
        setSelectedOrderForStatusModal(prev => prev?.id === updatedOrder.id ? updatedOrder : prev)
        setSelectedOrderForEdit(prev => prev?.id === updatedOrder.id ? updatedOrder : prev)
    }

    const patchOrderEverywhere = (orderId: string, patch: (order: Order) => Order) => {
        const patchMatchingOrder = (order: Order) => order.id === orderId ? patch(order) : order
        setOrders(prev => prev.map(patchMatchingOrder))
        setHistoricalOrders(prev => prev.map(patchMatchingOrder))
        setAllUpcomingOrders(prev => prev.map(patchMatchingOrder))
        setSelectedOrderForPayment(prev => prev?.id === orderId ? patch(prev) : prev)
        setSelectedOrderForStatusModal(prev => prev?.id === orderId ? patch(prev) : prev)
        setSelectedOrderForEdit(prev => prev?.id === orderId ? patch(prev) : prev)
    }

    const removeOrderEverywhere = (orderId: string) => {
        const removeOrder = (order: Order) => order.id !== orderId
        setOrders(prev => prev.filter(removeOrder))
        setHistoricalOrders(prev => prev.filter(removeOrder))
        setAllUpcomingOrders(prev => prev.filter(removeOrder))
        setSelectedOrderForPayment(prev => prev?.id === orderId ? null : prev)
        setSelectedOrderForStatusModal(prev => prev?.id === orderId ? null : prev)
        setSelectedOrderForEdit(prev => prev?.id === orderId ? null : prev)
    }

    // Handlers
    const handleLogout = () => {
        localStorage.removeItem('adminAuth')
        router.push('/')
    }

    const handleToggleStoreStatus = async () => {
        if (!business?.id) return
        setUpdatingStoreStatus(true)
        try {
            let currentStatus = business.manualStoreStatus
            if (currentStatus) {
                const now = new Date()
                const expiry = business.manualStatusExpiry ? toSafeDate(business.manualStatusExpiry) : null
                if (expiry && now >= expiry) {
                    currentStatus = null
                }
            }

            let newStatus: 'open' | 'closed' | null = null
            if (currentStatus === null || currentStatus === undefined) newStatus = 'closed'
            else if (currentStatus === 'closed') newStatus = 'open'
            else newStatus = null

            let expiryTime: Date | null = null
            if (newStatus !== null) {
                expiryTime = calculateManualStatusExpiry(business)
            }

            const updateData: any = { 
                manualStoreStatus: newStatus,
                manualStatusExpiry: expiryTime 
            }

            await updateBusiness(business.id, updateData)
            setBusiness(prev => prev ? { 
                ...prev, 
                manualStoreStatus: newStatus,
                manualStatusExpiry: expiryTime || undefined
            } : null)
        } catch (e) {
            console.error('Error updating store status:', e)
            alert('Error al actualizar estado de la tienda')
        } finally {
            setUpdatingStoreStatus(false)
        }
    }

    const handleUpdateDeliveryTime = async (minutes: number) => {
        if (!business?.id) return
        setUpdatingDeliveryTime(true)
        try {
            const baseTime = getConfiguredDeliveryTime(business)
            const currentTime = business.deliveryTime ?? baseTime
            const newTime = minutes === 0 ? baseTime : Math.max(1, currentTime + minutes)
            const updateData: Partial<Business> = { deliveryTime: newTime }

            if (business.defaultDeliveryTime == null) {
                updateData.defaultDeliveryTime = baseTime
            }

            await updateBusiness(business.id, updateData)
            setBusiness(prev => prev ? { ...prev, ...updateData } : null)
        } catch (e) {
            console.error(e)
            alert('Error al actualizar tiempo de entrega')
        } finally {
            setUpdatingDeliveryTime(false)
        }
    }

    const handleStatusChange = async (orderId: string, newStatus: Order['status'], reason?: string) => {
        const previousOrder = orders.find(o => o.id === orderId)
            || historicalOrders.find(o => o.id === orderId)
            || allUpcomingOrders.find(o => o.id === orderId);

        if (!previousOrder) return;

        // Actualización optimista de la UI: reflejar el cambio de estado inmediatamente sin esperar la base de datos
        patchOrderEverywhere(orderId, order => ({
            ...order,
            status: newStatus,
            updatedAt: new Date(),
            ...(reason ? { cancellationReason: reason } : {})
        }))

        try {
            let assignmentUpdate: any = {};

            const isScheduled = previousOrder.timing?.type === 'scheduled';
            const isDelivery = previousOrder.delivery?.type === 'delivery';
            const hasNoDeliveryAssigned = !previousOrder.delivery?.assignedDelivery;

            if (isDelivery && hasNoDeliveryAssigned) {
                if (previousOrder.status === 'pending' && newStatus !== 'cancelled' && newStatus !== 'pending' && !isScheduled) {
                    const assignedId = await autoAssignDeliveryForOrder(previousOrder, business?.defaultDeliveryId);
                    if (assignedId) {
                        assignmentUpdate['delivery.assignedDelivery'] = assignedId;
                    }
                }
                else if (previousOrder.status === 'confirmed' && newStatus === 'preparing' && isScheduled) {
                    const assignedId = await autoAssignDeliveryForOrder(previousOrder, business?.defaultDeliveryId);
                    if (assignedId) {
                        assignmentUpdate['delivery.assignedDelivery'] = assignedId;
                    }
                }
            }

            await updateOrderStatus(orderId, newStatus, reason, 'app')

            if (Object.keys(assignmentUpdate).length > 0) {
                const orderRef = doc(db, 'orders', orderId);
                await updateDoc(orderRef, assignmentUpdate);

                // Aplicar actualización de repartidor en caso de que se haya auto-asignado
                patchOrderEverywhere(orderId, order => ({
                    ...order,
                    delivery: {
                        ...order.delivery,
                        ...(assignmentUpdate['delivery.assignedDelivery']
                            ? { assignedDelivery: assignmentUpdate['delivery.assignedDelivery'] }
                            : {})
                    }
                }))
            }
        } catch (error) {
            console.error("Error updating status:", error)
            // Revertir estado optimista en caso de error
            updateOrderEverywhere(previousOrder)
            alert("Error al actualizar estado")
        }
    }

    const handleDeliveryAssignment = async (orderId: string, deliveryId: string) => {
        try {
            const orderRef = doc(db, 'orders', orderId)
            await updateDoc(orderRef, {
                'delivery.assignedDelivery': deliveryId || null,
                'delivery.acceptanceStatus': 'pending'
            })
            const applyDeliveryUpdate = (order: Order) => order.id === orderId
                ? {
                    ...order,
                    delivery: {
                        ...order.delivery,
                        assignedDelivery: deliveryId || undefined,
                        acceptanceStatus: 'pending' as const
                    }
                }
                : order
            setOrders(prev => prev.map(applyDeliveryUpdate))
            setHistoricalOrders(prev => prev.map(applyDeliveryUpdate))
            setAllUpcomingOrders(prev => prev.map(applyDeliveryUpdate))
            setSelectedOrderForStatusModal(prev => prev?.id === orderId ? applyDeliveryUpdate(prev) : prev)
        } catch (error) {
            console.error("Error assigning delivery:", error)
            alert("Error al asignar repartidor")
        }
    }

    const handleAutoAssignFuddi = async (orderToAssign: Order) => {
        try {
            const assignedId = await autoAssignDeliveryForOrder(orderToAssign, undefined)
            if (assignedId) {
                await handleDeliveryAssignment(orderToAssign.id, assignedId)
                const deliveryObj = availableDeliveries.find(d => d.id === assignedId)
                alert(`Delivery Fuddi asignado exitosamente: ${deliveryObj?.nombres || 'Repartidor'}`)
            } else {
                alert('No se encontró repartidor de Delivery Fuddi activo en esta zona en este momento.')
            }
        } catch (error) {
            console.error('Error al auto-asignar Delivery Fuddi:', error)
            alert('Ocurrió un error al buscar repartidor de Delivery Fuddi.')
        }
    }

    const handlePaymentClick = (order: Order) => {
        setSelectedOrderForPayment(order)
        setPaymentModalOpen(true)
    }

    const handleSendWhatsAppToDelivery = async (order: Order) => {
        try {
            const orderBusiness = businesses.find(b => b.id === order.businessId) || business
            await sendWhatsAppToDelivery(order, availableDeliveries, orderBusiness)
        } catch (e) {
            console.error("Error sending WhatsApp", e)
            alert("Error al enviar WhatsApp")
        }
    }

    const handleSendWhatsAppToStore = async (order: Order) => {
        try {
            const orderBusiness = businesses.find(b => b.id === order.businessId) || business
            if (!orderBusiness) {
                alert("No se encontró la información de la tienda")
                return
            }
            await sendOrderToStore(order, orderBusiness)
        } catch (e) {
            console.error("Error sending WhatsApp to store", e)
            alert("Error al enviar WhatsApp a la tienda")
        }
    }

    const handleDeleteOrder = async (orderId: string) => {
        if (!window.confirm('¿Estás seguro de que deseas eliminar este pedido? (Acción de administrador)')) return

        try {
            await deleteOrder(orderId, true)
            removeOrderEverywhere(orderId)
        } catch (error) {
            console.error("Error deleting order", error)
            alert("No se pudo eliminar el pedido")
        }
    }

    const handlePrint = async (order: Order, silent: boolean = false) => {
        if (!silent) {
            showToastMessage('Imprimiendo...', 'bi-printer')
        }
        try {
            const orderBusiness = businesses.find(b => b.id === order.businessId) || business
            if (printMode === 'bluetooth') {
                const { printOrderBluetooth } = await import('@/lib/bluetooth-print-utils')
                await printOrderBluetooth({
                    order: order as any,
                    businessName: orderBusiness?.name || "Negocio",
                    businessLogo: orderBusiness?.image,
                    groupItemsByProduct: orderBusiness?.notificationSettings?.groupItemsByProduct ?? true
                })
            } else {
                const { printOrder } = await import('@/lib/print-utils')
                await printOrder({
                    order: order as any,
                    businessName: orderBusiness?.name || "Negocio",
                    businessLogo: orderBusiness?.image,
                    groupItemsByProduct: orderBusiness?.notificationSettings?.groupItemsByProduct ?? true
                })
            }
        } catch (e: any) {
            console.error("Error printing", e)
            if (silent) return
            if (printMode === 'bluetooth' && e.name === 'NotFoundError') return
            alert("Error al imprimir: " + (e.message || "Error desconocido"))
        }
    }

    const handleOpenManualOrderFromCheckout = (checkoutSession: CheckoutSession) => {
        logDebug('checkout', 'Admin presiona Completar en sesión de checkout activo (pedidos)', {
            checkoutSessionId: checkoutSession.id,
            customerData: checkoutSession.customerData,
            timingData: checkoutSession.timingData,
            deliveryData: checkoutSession.deliveryData,
            cartItemsCount: checkoutSession.cartItems?.length || 0,
            businessId: checkoutSession.businessId || business?.id
        }, {
            businessId: checkoutSession.businessId || business?.id,
            businessName: business?.name,
            level: 'info'
        })

        const tempOrder: any = {
            id: `checkout-${checkoutSession.id}`,
            businessId: checkoutSession.businessId || checkoutSession.cartItems?.[0]?.originalBusinessId || business?.id || '',
            customer: checkoutSession.customerData,
            delivery: {
                type: checkoutSession.deliveryData?.type || 'delivery',
                address: checkoutSession.deliveryData?.address || '',
                references: checkoutSession.deliveryData?.references || '',
                deliveryCost: parseFloat(checkoutSession.deliveryData?.tarifa || '0'),
                latlong: checkoutSession.deliveryData?.latlong || '',
                photo: (checkoutSession.deliveryData as any)?.photo || ''
            },
            timing: checkoutSession.timingData,
            payment: {
                ...checkoutSession.paymentData,
                paymentStatus: 'pending'
            },
            items: checkoutSession.cartItems,
            total: (checkoutSession.cartItems?.reduce((acc: number, item: any) => acc + ((item.price || item.product?.price || 0) * item.quantity), 0) || 0) + (parseFloat(checkoutSession.deliveryData?.tarifa || '0')),
            status: 'pending',
            createdAt: new Date(),
            checkoutSessionId: checkoutSession.id,
            _isFromCheckout: true
        }

        setSelectedOrderForEdit(tempOrder)
        setManualSidebarMode('edit')
        setManualOrderSidebarOpen(true)
    }

    const handleOrderUpdatedFromModal = (updatedOrder: Order) => {
        updateOrderEverywhere(updatedOrder)
    }

    const togglePrintMode = () => {
        const newMode = printMode === 'standard' ? 'bluetooth' : 'standard'
        setPrintMode(newMode)
        localStorage.setItem('fuddi_print_mode', newMode)
    }

    // Render loading screen during authentication check
    if (authLoading) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
            </div>
        )
    }

    if (!isAuthenticated) return null

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col font-sans">
            {/* Admin Page Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-40 w-full shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16 sm:h-20">
                        {/* Logo and Selector */}
                        <div className="flex items-center space-x-4">
                            <button
                                onClick={() => {
                                    setActiveSidebarTab('menu')
                                    setIsMenuSidebarOpen(true)
                                }}
                                className="p-2 -ml-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-all"
                                title="Abrir menú"
                            >
                                <i className="bi bi-list text-2xl"></i>
                            </button>
                            <span 
                                onClick={() => router.push('/admin/dashboard')}
                                className="text-xl sm:text-2xl font-black text-red-600 tracking-tighter hover:opacity-80 transition-opacity cursor-pointer"
                            >
                                Fuddi Admin
                            </span>
                            
                            {/* Segment Tabs */}
                            <div className="hidden sm:flex bg-gray-100 p-1 rounded-xl border border-gray-200">
                                <button
                                    onClick={() => setOrdersSubTab('today')}
                                    className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${ordersSubTab === 'today' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    Hoy ({orders.length})
                                </button>
                                <button
                                    onClick={() => setOrdersSubTab('history')}
                                    className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${ordersSubTab === 'history' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    Historial
                                </button>
                            </div>
                        </div>

                        {/* Store Details Controls & Select Store */}
                        <div className="flex items-center space-x-2 sm:space-x-4">
                            {/* Open status toggle */}
                            {business && (
                                <div className="flex items-center gap-2">
                                    <div className="hidden lg:flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                                        <div className={`w-2 h-2 rounded-full ${isStoreOpen(business) ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                                        <span className="text-xs font-bold text-gray-700">
                                            {isStoreOpen(business) ? 'Abierto' : 'Cerrado'}
                                        </span>
                                    </div>

                                    {(() => {
                                        const isManualActive = business.manualStoreStatus && (!business.manualStatusExpiry || new Date() < toSafeDate(business.manualStatusExpiry))
                                        return (
                                            <button
                                                onClick={handleToggleStoreStatus}
                                                disabled={updatingStoreStatus}
                                                className="p-2 sm:px-3 sm:py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 disabled:opacity-50"
                                                title={isManualActive ? (business.manualStoreStatus === 'open' ? 'Abierto (Manual)' : 'Cerrado (Manual)') : 'Horario Automático'}
                                            >
                                                <i className={`bi ${isManualActive ? (business.manualStoreStatus === 'open' ? 'bi-unlock-fill text-green-600' : 'bi-lock-fill text-red-600') : `bi-clock-fill ${isStoreOpen(business) ? 'text-green-600' : 'text-gray-400'}`}`} />
                                            </button>
                                        )
                                    })()}
                                </div>
                            )}

                            {/* Delivery Time Control */}
                            {business && (
                                <div className="relative" ref={timeDropdownRef}>
                                    <button
                                        onClick={() => setShowTimeDropdown(!showTimeDropdown)}
                                        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border transition-colors ${isDeliveryTimeExtended ? 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'}`}
                                    >
                                        <span className="text-xs font-bold">
                                            {currentDeliveryTime}<span className="inline"> min</span>
                                        </span>
                                    </button>

                                    {showTimeDropdown && (
                                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50">
                                            {[5, 10, 30].map((mins) => (
                                                <button
                                                    key={mins}
                                                    onClick={() => { handleUpdateDeliveryTime(mins); setShowTimeDropdown(false); }}
                                                    disabled={updatingDeliveryTime}
                                                    className="w-full px-4 py-2 text-left hover:bg-red-50 hover:text-red-600 text-sm font-bold flex items-center justify-between"
                                                >
                                                    <span>+{mins} minutos</span>
                                                </button>
                                            ))}
                                            <div className="border-t border-gray-50 mt-1 pt-1">
                                                <button
                                                    onClick={() => { handleUpdateDeliveryTime(0); setShowTimeDropdown(false); }}
                                                    disabled={updatingDeliveryTime}
                                                    className="w-full px-4 py-2 text-left hover:bg-gray-50 text-xs text-gray-500 font-medium"
                                                >
                                                    Restablecer a {configuredDeliveryTime} min
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <QueueStatusIndicator status={queueStatus} onRetry={retryFailed} className="hidden md:flex" />

                            {/* Bell notification */}
                            {selectedBusinessId && selectedBusinessId !== 'all' && (
                                <NotificationsBell businessId={selectedBusinessId} onNewOrder={() => {}} />
                            )}

                            {/* Select Business Dropdown with Search */}
                            <div className="relative" ref={businessDropdownRef}>
                                <button
                                    onClick={() => setShowBusinessDropdown(!showBusinessDropdown)}
                                    className="flex items-center space-x-2 bg-gray-50 hover:bg-gray-100 px-3 py-2 rounded-xl border border-gray-200 transition-colors"
                                >
                                    <div className="w-6 h-6 rounded-full overflow-hidden bg-gray-200 shrink-0">
                                        {selectedBusinessId === 'all' ? (
                                            <div className="w-full h-full flex items-center justify-center bg-red-100 text-red-600"><i className="bi bi-globe text-xs"></i></div>
                                        ) : business?.image ? (
                                            <img src={business.image} alt={business.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-red-100 text-red-600"><i className="bi bi-shop text-xs"></i></div>
                                        )}
                                    </div>
                                    <span className="font-bold text-xs text-gray-700 max-w-[120px] truncate hidden md:inline">
                                        {selectedBusinessId === 'all' ? "Todas las tiendas" : (business?.name || "Seleccionar...")}
                                    </span>
                                    <i className="bi bi-chevron-down text-gray-500 text-[10px]"></i>
                                </button>

                                {showBusinessDropdown && (
                                    <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150 flex flex-col max-h-96">
                                        {/* Search Filter inside dropdown */}
                                        <div className="px-3 py-2 border-b border-gray-100">
                                            <div className="relative">
                                                <i className="bi bi-search absolute left-3 top-2.5 text-gray-400 text-xs"></i>
                                                <input
                                                    type="text"
                                                    placeholder="Buscar tienda..."
                                                    value={searchQuery}
                                                    onChange={(e) => setSearchQuery(e.target.value)}
                                                    className="w-full pl-8 pr-3 py-1.5 bg-gray-50 rounded-xl border-none text-xs outline-none focus:ring-1 focus:ring-red-100"
                                                />
                                            </div>
                                        </div>

                                        <div className="overflow-y-auto flex-1 py-1">
                                            {businessesLoading ? (
                                                <div className="flex justify-center items-center py-4">
                                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-600"></div>
                                                </div>
                                            ) : (
                                                <>
                                                    {/* Opción Todas las tiendas */}
                                                    {(!searchQuery || "todas las tiendas".includes(searchQuery.toLowerCase())) && (
                                                        <button
                                                            onClick={() => {
                                                                handleBusinessChange('all')
                                                                setShowBusinessDropdown(false)
                                                                setSearchQuery('')
                                                            }}
                                                            className={`w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors ${selectedBusinessId === 'all' ? 'bg-red-50' : ''}`}
                                                        >
                                                            <div className="w-8 h-8 rounded-full overflow-hidden bg-red-100 flex items-center justify-center text-red-600 shrink-0">
                                                                <i className="bi bi-globe text-sm"></i>
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-bold text-xs text-gray-900 truncate leading-tight">Todas las tiendas</p>
                                                                <p className="text-[9px] text-gray-400 font-medium">Ver todos los pedidos</p>
                                                            </div>
                                                            {selectedBusinessId === 'all' && <i className="bi bi-check-circle-fill text-red-600 text-sm"></i>}
                                                        </button>
                                                    )}

                                                    {filteredBusinesses.length === 0 && searchQuery ? (
                                                        <p className="text-center text-xs text-gray-400 py-4 font-medium uppercase tracking-wide">Sin coincidencias</p>
                                                    ) : (
                                                        filteredBusinesses.map((biz) => (
                                                            <button
                                                                key={biz.id}
                                                                onClick={() => {
                                                                    handleBusinessChange(biz.id)
                                                                    setShowBusinessDropdown(false)
                                                                    setSearchQuery('')
                                                                }}
                                                                className={`w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors ${selectedBusinessId === biz.id ? 'bg-red-50' : ''}`}
                                                            >
                                                                <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-200 shrink-0">
                                                                    {biz.image ? (
                                                                        <img src={biz.image} alt={biz.name} className="w-full h-full object-cover" />
                                                                    ) : (
                                                                        <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-400"><i className="bi bi-shop"></i></div>
                                                                    )}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="font-bold text-xs text-gray-900 truncate leading-tight">{biz.name}</p>
                                                                    <p className="text-[9px] text-gray-400 font-medium">@{biz.username}</p>
                                                                </div>
                                                                {selectedBusinessId === biz.id && <i className="bi bi-check-circle-fill text-red-600 text-sm"></i>}
                                                            </button>
                                                        ))
                                                    )}
                                                </>
                                            )}
                                        </div>

                                        <hr className="border-gray-50 my-1" />
                                        <button 
                                            onClick={handleLogout} 
                                            className="w-full flex items-center space-x-2 px-4 py-2.5 text-left text-xs font-bold text-red-600 hover:bg-red-50 transition-colors"
                                        >
                                            <i className="bi bi-box-arrow-right"></i>
                                            <span>Salir del Panel</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Mobile View Navigation Toggle */}
            <div className="sm:hidden bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-center gap-4">
                <button
                    onClick={() => setOrdersSubTab('today')}
                    className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition-all ${ordersSubTab === 'today' ? 'bg-red-50 text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    Hoy ({orders.length})
                </button>
                <button
                    onClick={() => setOrdersSubTab('history')}
                    className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition-all ${ordersSubTab === 'history' ? 'bg-red-50 text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    Historial
                </button>
            </div>

            {/* Main Area */}
            <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
                {ordersSubTab === 'history' ? (
                    <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6 shadow-sm">
                        <OrderHistory
                            orders={mergedHistoryOrders}
                            onLoadMore={loadHistory}
                            hasMore={hasMoreHistory}
                            loadingMore={historyLoading}
                            onOrderEdit={(o) => {
                                setSelectedOrderForEdit(o)
                                setManualSidebarMode('edit')
                                setManualOrderSidebarOpen(true)
                            }}
                            onOrderDelete={(id) => handleDeleteOrder(id)}
                            onOrderStatusChange={handleStatusChange}
                            getStatusColor={getStatusColor}
                            getStatusText={getStatusText}
                            getOrderDateTime={(o) => {
                                if (o.timing?.type === 'scheduled' && o.timing.scheduledDate) {
                                    const date = toSafeDate(o.timing.scheduledDate)
                                    if (o.timing.scheduledTime) {
                                        const [h, m] = o.timing.scheduledTime.split(':').map(Number)
                                        date.setHours(h, m, 0, 0)
                                    }
                                    return date
                                }
                                return toSafeDate(o.createdAt)
                            }}
                            availableDeliveries={availableDeliveries}
                            onDeliveryAssign={handleDeliveryAssignment}
                            onPaymentEdit={(order) => handlePaymentClick(order)}
                            onWhatsAppDelivery={() => {}}
                            onPrint={(order, silent) => handlePrint(order as Order, silent)}
                            onDeliveryStatusClick={(order) => {
                                setSelectedOrderForStatusModal(order)
                                setDeliveryStatusModalOpen(true)
                            }}
                            onCustomerClick={(order) => {
                                setSelectedOrderForCustomerContact(order)
                                setCustomerContactModalOpen(true)
                            }}
                            businessPhone={business?.phone}
                            autoPrintOnConfirm={business?.notificationSettings?.autoPrintOnConfirm ?? true}
                            canDeleteOrders={true}
                        />
                        {historyLoading && (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {/* Daily Check-in Banner */}
                        {business && business.requireDailyCheckIn && (
                            <DailyCheckInBanner
                                business={business}
                                onBusinessUpdate={(updated) => {
                                    setBusiness(prev => prev ? { ...prev, ...updated } : prev)
                                }}
                            />
                        )}

                        {loading ? (
                            <div className="flex justify-center items-center py-24">
                                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-600"></div>
                            </div>
                        ) : orders.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-24 px-4 text-center bg-white rounded-3xl border border-gray-100 shadow-sm max-w-sm mx-auto animate-in fade-in duration-300">
                                <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center text-red-600 mb-4">
                                    <i className="bi bi-inbox text-2xl"></i>
                                </div>
                                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider mb-1">Sin pedidos para hoy</h3>
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider leading-relaxed">Aquí aparecerán los pedidos de la tienda conforme vayan llegando.</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Totals Summary for Mobile (Top) */}
                                <div 
                                    onClick={() => setSummaryExpanded(!summaryExpanded)}
                                    className="lg:hidden bg-white rounded-xl border border-gray-100 p-4 mb-4 shadow-sm cursor-pointer hover:bg-gray-50 transition-all"
                                >
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="text-left">
                                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Visitas</p>
                                            <p className="text-lg font-bold text-gray-900 flex items-center gap-1">
                                                <i className="bi bi-people text-gray-400 text-xs"></i>
                                                {visitsCount}
                                            </p>
                                        </div>

                                        <div className="text-right">
                                            <div className="flex flex-col items-end">
                                                <p className="text-lg font-bold text-emerald-600">
                                                    ${totalTodaySales.toFixed(2)}
                                                </p>
                                                {totalTodayPublicSales > totalTodaySales && (
                                                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                                                        Público: ${totalTodayPublicSales.toFixed(2)}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col lg:flex-row gap-6 items-start">
                                    {/* Column 1: Borrador, Pendiente y Live Checkouts */}
                                    <div className={`${showCol1 ? 'block' : 'hidden lg:block'} w-full lg:flex-1 lg:min-w-0 space-y-6`}>
                                        {selectedBusinessId && (
                                            <LiveCheckoutsPanel
                                                businessId={selectedBusinessId}
                                                orders={orders}
                                                onCountChange={setCheckoutCount}
                                                onOpenManualOrder={handleOpenManualOrderFromCheckout}
                                            />
                                        )}
                                        <OrderStatusColumn
                                            statuses={['borrador', 'pending']}
                                            orders={orders}
                                            availableDeliveries={availableDeliveries}
                                            handleStatusChange={handleStatusChange}
                                            handleDeliveryAssignment={handleDeliveryAssignment}
                                            handlePaymentClick={handlePaymentClick}
                                            handleSendWhatsAppToDelivery={handleSendWhatsAppToDelivery}
                                            handleSendWhatsAppToStore={handleSendWhatsAppToStore}
                                            handlePrint={handlePrint}
                                            setSelectedOrderForStatusModal={setSelectedOrderForStatusModal}
                                            setDeliveryStatusModalOpen={setDeliveryStatusModalOpen}
                                            setSelectedOrderForEdit={setSelectedOrderForEdit}
                                            setManualSidebarMode={setManualSidebarMode}
                                            setManualOrderSidebarOpen={setManualOrderSidebarOpen}
                                            handleDeleteOrder={handleDeleteOrder}
                                            setSelectedOrderForCustomerContact={setSelectedOrderForCustomerContact}
                                            setCustomerContactModalOpen={setCustomerContactModalOpen}
                                            business={business}
                                            canChangeDelivery={true}
                                            canDeleteOrders={true}
                                            deliveryTimeMinutes={currentDeliveryTime}
                                            autoPrintOnConfirm={business?.notificationSettings?.autoPrintOnConfirm ?? true}
                                            clientsWithNotes={clientsWithNotes}
                                            businesses={businesses}
                                            selectedBusinessId={selectedBusinessId}
                                        />
                                    </div>

                                    {/* Column 2: Confirmados */}
                                    <div className={`${showCol2 ? 'block' : 'hidden lg:block'} w-full lg:flex-1 lg:min-w-0 space-y-6`}>
                                        <OrderStatusColumn
                                            statuses={['confirmed']}
                                            orders={orders}
                                            availableDeliveries={availableDeliveries}
                                            handleStatusChange={handleStatusChange}
                                            handleDeliveryAssignment={handleDeliveryAssignment}
                                            handlePaymentClick={handlePaymentClick}
                                            handleSendWhatsAppToDelivery={handleSendWhatsAppToDelivery}
                                            handleSendWhatsAppToStore={handleSendWhatsAppToStore}
                                            handlePrint={handlePrint}
                                            setSelectedOrderForStatusModal={setSelectedOrderForStatusModal}
                                            setDeliveryStatusModalOpen={setDeliveryStatusModalOpen}
                                            setSelectedOrderForEdit={setSelectedOrderForEdit}
                                            setManualSidebarMode={setManualSidebarMode}
                                            setManualOrderSidebarOpen={setManualOrderSidebarOpen}
                                            handleDeleteOrder={handleDeleteOrder}
                                            setSelectedOrderForCustomerContact={setSelectedOrderForCustomerContact}
                                            setCustomerContactModalOpen={setCustomerContactModalOpen}
                                            business={business}
                                            canChangeDelivery={true}
                                            canDeleteOrders={true}
                                            deliveryTimeMinutes={currentDeliveryTime}
                                            autoPrintOnConfirm={business?.notificationSettings?.autoPrintOnConfirm ?? true}
                                            clientsWithNotes={clientsWithNotes}
                                            businesses={businesses}
                                            selectedBusinessId={selectedBusinessId}
                                        />
                                    </div>

                                    {/* Column 3: The Rest */}
                                    <div className={`${showCol3 || orders.length > 0 ? 'block' : 'hidden lg:block'} w-full lg:flex-1 lg:min-w-0 space-y-6`}>
                                        {/* Totals Summary for Desktop ONLY */}
                                        <div className="hidden lg:block bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="text-left">
                                                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Visitas Hoy</p>
                                                    <p className="text-2xl font-black text-gray-900 flex items-center gap-2">
                                                        <i className="bi bi-people text-gray-400 text-lg"></i>
                                                        {visitsCount}
                                                    </p>
                                                </div>

                                                <div className="text-right">
                                                    <div className="flex flex-col items-end">
                                                        <p className="text-2xl font-black text-emerald-600">
                                                            ${totalTodaySales.toFixed(2)}
                                                        </p>
                                                        {totalTodayPublicSales > totalTodaySales && (
                                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                                                                Público: ${totalTodayPublicSales.toFixed(2)}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <OrderStatusColumn
                                            statuses={[
                                                'preparing',
                                                { key: 'delivered-group', title: 'Entregado', statuses: ['ready', 'on_way', 'delivered'], statusColor: 'delivered', countStatus: 'delivered', defaultExpanded: false },
                                                'cancelled'
                                            ]}
                                            orders={orders}
                                            availableDeliveries={availableDeliveries}
                                            handleStatusChange={handleStatusChange}
                                            handleDeliveryAssignment={handleDeliveryAssignment}
                                            handlePaymentClick={handlePaymentClick}
                                            handleSendWhatsAppToDelivery={handleSendWhatsAppToDelivery}
                                            handleSendWhatsAppToStore={handleSendWhatsAppToStore}
                                            handlePrint={handlePrint}
                                            setSelectedOrderForStatusModal={setSelectedOrderForStatusModal}
                                            setDeliveryStatusModalOpen={setDeliveryStatusModalOpen}
                                            setSelectedOrderForEdit={setSelectedOrderForEdit}
                                            setManualSidebarMode={setManualSidebarMode}
                                            setManualOrderSidebarOpen={setManualOrderSidebarOpen}
                                            handleDeleteOrder={handleDeleteOrder}
                                            setSelectedOrderForCustomerContact={setSelectedOrderForCustomerContact}
                                            setCustomerContactModalOpen={setCustomerContactModalOpen}
                                            business={business}
                                            canChangeDelivery={true}
                                            canDeleteOrders={true}
                                            deliveryTimeMinutes={currentDeliveryTime}
                                            autoPrintOnConfirm={business?.notificationSettings?.autoPrintOnConfirm ?? true}
                                            clientsWithNotes={clientsWithNotes}
                                            businesses={businesses}
                                            selectedBusinessId={selectedBusinessId}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </main>

            {/* Floating Action Button for Manual Order */}
            {ordersSubTab === 'today' && selectedBusinessId && selectedBusinessId !== 'all' && (
                <button
                    onClick={() => {
                        setManualSidebarMode('create')
                        setSelectedOrderForEdit(null)
                        setManualOrderSidebarOpen(true)
                    }}
                    className="fixed bottom-6 right-6 w-14 h-14 bg-red-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-red-700 hover:scale-105 transition-all z-40"
                    style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
                >
                    <i className="bi bi-plus-lg text-2xl"></i>
                </button>
            )}

            {/* Modals and Sidebars */}
            <PaymentManagementModals
                isOpen={paymentModalOpen}
                onClose={() => setPaymentModalOpen(false)}
                order={selectedOrderForPayment}
                onOrderUpdated={handleOrderUpdatedFromModal}
            />

            <DeliveryStatusModal
                isOpen={deliveryStatusModalOpen}
                onClose={() => setDeliveryStatusModalOpen(false)}
                order={selectedOrderForStatusModal}
                deliveryAgent={availableDeliveries.find(d => d.id === selectedOrderForStatusModal?.delivery?.assignedDelivery)}
                availableDeliveries={availableDeliveries}
                canChangeDelivery={true}
                onDeliveryAssign={handleDeliveryAssignment}
                deliveryServiceType={business?.deliveryServiceType ?? 'fuddi'}
                defaultDeliveryId={business?.defaultDeliveryId}
                onAutoAssignFuddi={handleAutoAssignFuddi}
                onWhatsApp={() => {
                    if (selectedOrderForStatusModal) {
                        handleSendWhatsAppToDelivery(selectedOrderForStatusModal)
                        setDeliveryStatusModalOpen(false)
                    }
                }}
            />

            <ManualOrderSidebar
                isOpen={manualOrderSidebarOpen}
                onClose={() => {
                    setManualOrderSidebarOpen(false)
                    setSelectedOrderForEdit(null)
                    setManualSidebarMode('create')
                }}
                business={business}
                businesses={businesses}
                onBusinessChange={(newId) => {
                    setSelectedBusinessId(newId)
                    const found = businesses.find(b => b.id === newId)
                    if (found) setBusiness(found)
                }}
                products={products}
                onOrderCreated={(optimisticOrder) => {
                    if (optimisticOrder) {
                        setOrders(prev => [optimisticOrder as Order, ...prev])
                    }
                    setManualOrderSidebarOpen(false)
                }}
                mode={manualSidebarMode}
                editOrder={selectedOrderForEdit}
                onOrderUpdated={(updatedOrder) => {
                    if (updatedOrder) {
                        updateOrderEverywhere(updatedOrder as Order)
                    }
                    setManualOrderSidebarOpen(false)
                    setSelectedOrderForEdit(null)
                    setManualSidebarMode('create')
                }}
                setActiveTab={() => {}}
                setProfileSubTab={() => {}}
            />

            <CustomerContactModal
                isOpen={customerContactModalOpen}
                onClose={() => setCustomerContactModalOpen(false)}
                order={selectedOrderForCustomerContact}
            />

            {/* Menu Sidebar Component */}
            {isMenuSidebarOpen && (
                <div className="fixed inset-0 z-50 flex">
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in"
                        onClick={() => setIsMenuSidebarOpen(false)}
                    />
                    {/* Sidebar content container */}
                    <div className="relative flex flex-col w-full sm:max-w-sm bg-white h-full shadow-2xl animate-in slide-in-from-left duration-300">
                        {/* Header */}
                        {activeSidebarTab === 'menu' && (
                            <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50 shrink-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg font-black text-red-600 tracking-tighter">Fuddi Pedidos</span>
                                </div>
                                <button
                                    onClick={() => setIsMenuSidebarOpen(false)}
                                    className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                                >
                                    <i className="bi bi-x-lg text-lg"></i>
                                </button>
                            </div>
                        )}

                        {/* Sidebar Main Content */}
                        {activeSidebarTab === 'menu' ? (
                            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                <button
                                    onClick={() => setActiveSidebarTab('cierre')}
                                    className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold text-gray-700 hover:bg-red-50 hover:text-red-600 transition-all duration-200"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <i className="bi bi-calculator-fill text-lg text-red-500 shrink-0"></i>
                                        <span className="truncate">Cierre de Caja</span>
                                    </div>
                                    {pendingCierreCount > 0 && (
                                        <span className="px-2 py-0.5 rounded-full text-xs font-black bg-amber-500 text-white shadow-2xs shrink-0">
                                            {pendingCierreCount}
                                        </span>
                                    )}
                                </button>
                                <button
                                    onClick={() => setActiveSidebarTab('transferencias')}
                                    className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold text-gray-700 hover:bg-red-50 hover:text-red-600 transition-all duration-200"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <i className="bi bi-bank text-lg text-red-500 shrink-0"></i>
                                        <span className="truncate">Revisión de Transferencias</span>
                                    </div>
                                    {pendingTransfersCount > 0 && (
                                        <span className="px-2 py-0.5 rounded-full text-xs font-black bg-amber-500 text-white shadow-2xs shrink-0">
                                            {pendingTransfersCount}
                                        </span>
                                    )}
                                </button>
                                <button
                                    onClick={() => setActiveSidebarTab('reportes')}
                                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold text-gray-700 hover:bg-red-50 hover:text-red-600 transition-all duration-200"
                                >
                                    <i className="bi bi-bar-chart-line-fill text-lg text-red-500"></i>
                                    <span>Reportes</span>
                                </button>
                                <button
                                    onClick={() => {
                                        setIsMenuSidebarOpen(false)
                                        router.push('/admin/dashboard')
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all duration-200"
                                >
                                    <i className="bi bi-speedometer2 text-lg text-gray-400"></i>
                                    <span>Volver al Dashboard</span>
                                </button>
                            </div>
                        ) : activeSidebarTab === 'cierre' ? (
                            /* Cierre view inside the sidebar */
                            <CierreSidebarView
                                orders={orders}
                                availableDeliveries={availableDeliveries}
                                onBack={() => setActiveSidebarTab('menu')}
                                onClose={() => setIsMenuSidebarOpen(false)}
                                selectedBusinessId={selectedBusinessId}
                                businesses={businesses}
                                onManagePayment={handlePaymentClick}
                            />
                        ) : activeSidebarTab === 'reportes' ? (
                            /* Reportes view inside the sidebar */
                            <ReportesSidebarView
                                onBack={() => setActiveSidebarTab('menu')}
                                onClose={() => setIsMenuSidebarOpen(false)}
                                selectedBusinessId={selectedBusinessId}
                                businesses={businesses}
                            />
                        ) : activeSidebarTab === 'transferencias' ? (
                            /* Transferencias view inside the sidebar */
                            <TransferenciasSidebarView
                                onBack={() => setActiveSidebarTab('menu')}
                                onClose={() => setIsMenuSidebarOpen(false)}
                                selectedBusinessId={selectedBusinessId}
                                businesses={businesses}
                                onManagePayment={handlePaymentClick}
                            />
                        ) : null}
                    </div>
                </div>
            )}

            {/* Toast Notification */}
            {toast?.show && (
                <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-gray-900/95 backdrop-blur-md text-white px-4 py-3 rounded-2xl shadow-2xl border border-gray-800 animate-in slide-in-from-bottom-5 fade-in duration-200">
                    <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
                        <i className={`bi ${toast.icon || 'bi-printer'} text-lg animate-pulse`}></i>
                    </div>
                    <span className="text-sm font-semibold pr-1">{toast.message}</span>
                </div>
            )}
        </div>
    )
}
