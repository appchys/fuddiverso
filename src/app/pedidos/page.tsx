'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Business, Order, Delivery, Product } from '@/types'
import { db } from '@/lib/firebase'
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, Timestamp } from 'firebase/firestore'
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
    getOrdersByBusinessComplete,
    getAllBusinesses,
    getProductsByIds
} from '@/lib/database'
import {
    sendWhatsAppToDelivery,
    sendWhatsAppToCustomer,
    getNextStatus
} from '@/components/WhatsAppUtils'
import { isStoreOpen, calculateManualStatusExpiry } from '@/lib/store-utils'
import QueueStatusIndicator from '@/components/QueueStatusIndicator'
import NotificationsBell from '@/components/NotificationsBell'
import CierreSidebarView from '@/components/CierreSidebarView'

import { useOfflineQueue } from '@/hooks/useOfflineQueue'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'

import type { CheckoutSession } from '@/components/LiveCheckoutsPanel'

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
const autoAssignDeliveryForOrder = async (order: Order, defaultDeliveryId?: string): Promise<string | undefined> => {
    try {
        const deliveries = await getDeliveriesByStatus('activo');
        let assignedDeliveryId: string | undefined = undefined;

        // 0. Default Delivery
        if (defaultDeliveryId) {
            const defaultDelivery = deliveries.find(d => d.id === defaultDeliveryId);
            if (defaultDelivery) {
                console.log('[AutoAssign] Using store default delivery:', defaultDeliveryId);
                return defaultDelivery.id;
            }
        }

        // 1. Coverage Zone
        const latlong = order.delivery.latlong;
        if (latlong && !latlong.startsWith('pluscode:')) {
            const [lat, lng] = latlong.split(',').map(Number);
            if (!isNaN(lat) && !isNaN(lng)) {
                const zones = await getCoverageZones();
                const matchingZone = zones.find(zone =>
                    zone.isActive &&
                    zone.assignedDeliveryId &&
                    isPointInPolygon({ lat, lng }, zone.polygon)
                );

                if (matchingZone?.assignedDeliveryId) {
                    const zoneDelivery = deliveries.find(d => d.id === matchingZone.assignedDeliveryId);
                    if (zoneDelivery) {
                        assignedDeliveryId = zoneDelivery.id;
                    }
                }
            }
        }

        // 2. Fallbacks
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
    const [activeSidebarTab, setActiveSidebarTab] = useState<'menu' | 'cierre'>('menu')

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
                
                // Cargar también productos compartidos
                try {
                    const biz = await getBusiness(selectedBusinessId)
                    if (biz?.sharedProductIds && biz.sharedProductIds.length > 0) {
                        const sharedProducts = await getProductsByIds(biz.sharedProductIds)
                        const allBizs = await getAllBusinesses()
                        const availableShared = sharedProducts
                            .filter(p => p.isAvailable)
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
        let scheduledStringQueryLoaded = false
        let cancelled = false

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
            
            if (activeQueryLoaded && createdQueryLoaded && scheduledQueryLoaded && scheduledStringQueryLoaded) {
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

        // Listener 3: Scheduled orders for today (Date object query)
        const qScheduledToday = selectedBusinessId === 'all'
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
        const unsubScheduled = onSnapshot(qScheduledToday, (snapshot) => {
            handleDocChanges(snapshot)
            snapshot.docs.forEach(doc => {
                ordersMap.set(doc.id, { id: doc.id, ...doc.data() } as Order)
            })
            snapshot.docChanges().forEach(change => {
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
        }, (error) => {
            console.error("Error in unsubScheduled:", error)
            scheduledQueryLoaded = true
            updateOrdersState()
        })

        // Listener 4: Scheduled orders for today (String query)
        const todayString = toLocalDateInputValue(startOfDay)
        const tomorrowString = toLocalDateInputValue(endOfDay)
        const qScheduledTodayString = selectedBusinessId === 'all'
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
        const unsubScheduledString = onSnapshot(qScheduledTodayString, (snapshot) => {
            handleDocChanges(snapshot)
            snapshot.docs.forEach(doc => {
                ordersMap.set(doc.id, { id: doc.id, ...doc.data() } as Order)
            })
            snapshot.docChanges().forEach(change => {
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
            scheduledStringQueryLoaded = true
            updateOrdersState()
        }, (error) => {
            console.error("Error in unsubScheduledString:", error)
            scheduledStringQueryLoaded = true
            updateOrdersState()
        })

        // Legacy scheduled orders fallback loader
        const loadLegacyScheduledToday = async () => {
            if (selectedBusinessId === 'all') return
            try {
                const allOrders = await getOrdersByBusinessComplete(selectedBusinessId)
                if (cancelled) return

                allOrders.forEach(order => {
                    if (order.timing?.type === 'scheduled' && isOrderForToday(order)) {
                        ordersMap.set(order.id, order)
                    }
                })
                updateOrdersState()
            } catch (error) {
                console.error("Error loading legacy scheduled orders:", error)
            }
        }
        loadLegacyScheduledToday()

        const checkFirstLoad = setInterval(() => {
            if (activeQueryLoaded && createdQueryLoaded && scheduledQueryLoaded && scheduledStringQueryLoaded) {
                isFirstOrdersLoad.current = false
                clearInterval(checkFirstLoad)
            }
        }, 500)

        return () => {
            cancelled = true
            unsubCreated()
            unsubActive()
            unsubScheduled()
            unsubScheduledString()
            clearInterval(checkFirstLoad)
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
        try {
            const currentOrder = orders.find(o => o.id === orderId)
                || historicalOrders.find(o => o.id === orderId)
                || allUpcomingOrders.find(o => o.id === orderId);
            let assignmentUpdate: any = {};

            const isScheduled = currentOrder?.timing?.type === 'scheduled';
            const isDelivery = currentOrder?.delivery?.type === 'delivery';
            const hasNoDeliveryAssigned = !currentOrder?.delivery?.assignedDelivery;

            if (currentOrder && isDelivery && hasNoDeliveryAssigned) {
                if (currentOrder.status === 'pending' && newStatus !== 'cancelled' && newStatus !== 'pending' && !isScheduled) {
                    const assignedId = await autoAssignDeliveryForOrder(currentOrder, business?.defaultDeliveryId);
                    if (assignedId) {
                        assignmentUpdate['delivery.assignedDelivery'] = assignedId;
                    }
                }
                else if (currentOrder.status === 'confirmed' && newStatus === 'preparing' && isScheduled) {
                    const assignedId = await autoAssignDeliveryForOrder(currentOrder, business?.defaultDeliveryId);
                    if (assignedId) {
                        assignmentUpdate['delivery.assignedDelivery'] = assignedId;
                    }
                }
            }

            await updateOrderStatus(orderId, newStatus, reason, 'app')

            if (Object.keys(assignmentUpdate).length > 0) {
                const orderRef = doc(db, 'orders', orderId);
                await updateDoc(orderRef, assignmentUpdate);
            }

            patchOrderEverywhere(orderId, order => ({
                ...order,
                status: newStatus,
                updatedAt: new Date(),
                ...(reason ? { cancellationReason: reason } : {}),
                delivery: {
                    ...order.delivery,
                    ...(assignmentUpdate['delivery.assignedDelivery']
                        ? { assignedDelivery: assignmentUpdate['delivery.assignedDelivery'] }
                        : {})
                }
            }))
        } catch (error) {
            console.error("Error updating status:", error)
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
            await sendWhatsAppToDelivery(order, availableDeliveries, business)
        } catch (e) {
            console.error("Error sending WhatsApp", e)
            alert("Error al enviar WhatsApp")
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
        try {
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
            console.error("Error printing", e)
            if (silent) return
            if (printMode === 'bluetooth' && e.name === 'NotFoundError') return
            alert("Error al imprimir: " + (e.message || "Error desconocido"))
        }
    }

    const handleOpenManualOrderFromCheckout = (checkoutSession: CheckoutSession) => {
        const tempOrder: any = {
            id: `checkout-${checkoutSession.id}`,
            businessId: checkoutSession.businessId,
            customer: checkoutSession.customerData,
            delivery: {
                type: checkoutSession.deliveryData.type,
                address: checkoutSession.deliveryData.address,
                references: checkoutSession.deliveryData.references,
                deliveryCost: parseFloat(checkoutSession.deliveryData.tarifa || '0'),
                latlong: checkoutSession.deliveryData.latlong
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
                products={products}
                onOrderCreated={() => setManualOrderSidebarOpen(false)}
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

                        {/* Sidebar Main Content */}
                        {activeSidebarTab === 'menu' ? (
                            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                <button
                                    onClick={() => setActiveSidebarTab('cierre')}
                                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold text-gray-700 hover:bg-red-50 hover:text-red-600 transition-all duration-200"
                                >
                                    <i className="bi bi-calculator-fill text-lg text-red-500"></i>
                                    <span>Cierre de Caja</span>
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
                                selectedBusinessId={selectedBusinessId}
                                businesses={businesses}
                                onManagePayment={handlePaymentClick}
                            />
                        ) : null}
                    </div>
                </div>
            )}
        </div>
    )
}

// Inlined Sub-components for full self-containment
function CustomerContactModal({
    isOpen,
    onClose,
    order
}: {
    isOpen: boolean,
    onClose: () => void,
    order: Order | null
}) {
    if (!isOpen || !order) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onMouseDown={onClose}
        >
            <div
                className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="p-6">
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <h3 className="text-xl font-bold text-gray-900">Contactar Cliente</h3>
                            <p className="text-sm text-gray-500 mt-1">{order.customer?.name}</p>
                        </div>
                        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg text-gray-400">
                            <i className="bi bi-x-lg"></i>
                        </button>
                    </div>

                    <div className="space-y-3">
                        <button
                            onClick={() => {
                                sendWhatsAppToCustomer(order)
                                onClose()
                            }}
                            className="w-full flex items-center justify-center gap-3 py-4 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-200"
                        >
                            <i className="bi bi-whatsapp text-xl"></i>
                            Enviar WhatsApp
                        </button>

                        <a
                            href={`tel:${order.customer?.phone}`}
                            onClick={onClose}
                            className="w-full flex items-center justify-center gap-3 py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
                        >
                            <i className="bi bi-telephone-fill text-xl"></i>
                            Llamar por teléfono
                        </a>
                    </div>
                </div>
            </div>
        </div>
    )
}



const getDeliveryCoordinates = (order: Order | null) => {
    if (!order?.delivery) return null
    if (typeof order.delivery.mapLocation?.lat === 'number' && typeof order.delivery.mapLocation?.lng === 'number') {
        return {
            lat: order.delivery.mapLocation.lat,
            lng: order.delivery.mapLocation.lng
        }
    }

    const latlong = order.delivery.latlong
    if (!latlong || latlong.startsWith('pluscode:')) return null
    const [lat, lng] = latlong.split(',').map(value => Number(value.trim()))

    if (Number.isNaN(lat) || Number.isNaN(lng)) return null
    return { lat, lng }
}

const getDeliveryZone = (order: Order | null) => {
    const delivery = order?.delivery as any
    return delivery?.sector || delivery?.address || delivery?.zoneName || delivery?.coverageZoneName || 'No especificado'
}

function DeliveryStatusModal({
    isOpen,
    onClose,
    order,
    deliveryAgent,
    availableDeliveries,
    canChangeDelivery,
    onDeliveryAssign,
    onWhatsApp,
    deliveryServiceType,
    defaultDeliveryId,
    onAutoAssignFuddi
}: {
    isOpen: boolean,
    onClose: () => void,
    order: Order | null,
    deliveryAgent?: Delivery,
    availableDeliveries: Delivery[],
    canChangeDelivery: boolean,
    onDeliveryAssign: (id: string, deliveryId: string) => void | Promise<void>,
    onWhatsApp: () => void,
    deliveryServiceType?: 'self' | 'fuddi',
    defaultDeliveryId?: string,
    onAutoAssignFuddi?: (order: Order) => void | Promise<void>
}) {
    const [isSearchingFuddi, setIsSearchingFuddi] = useState(false)
    const [showSelfSelect, setShowSelfSelect] = useState(false)

    if (!isOpen || !order) return null

    const status = order.delivery?.acceptanceStatus
    const isUnassigned = !order.delivery?.assignedDelivery
    const isFuddiConfigured = (deliveryServiceType ?? 'fuddi') === 'fuddi'
    const agentCardClass = isUnassigned
        ? 'bg-gray-50 border-gray-200'
        : status === 'accepted'
            ? 'bg-green-50 border-green-200'
            : 'bg-yellow-50 border-yellow-200'

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onMouseDown={onClose}
        >
            <div
                className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="p-6">
                    <div className="flex justify-between items-start mb-6">
                        <h3 className="text-xl font-bold text-gray-900">Estado del Delivery</h3>
                        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg text-gray-400">
                            <i className="bi bi-x-lg"></i>
                        </button>
                    </div>

                    <div className="space-y-6">
                        {isUnassigned && isFuddiConfigured ? (
                            <div className="space-y-4">
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                    Selecciona el método de delivery
                                </p>

                                {/* Opción Autogestión */}
                                <div className={`p-4 rounded-xl border-2 transition-all ${showSelfSelect ? 'border-orange-500 bg-orange-50/50' : 'border-gray-200 hover:border-orange-300 bg-white'}`}>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (defaultDeliveryId && availableDeliveries.some(d => d.id === defaultDeliveryId)) {
                                                await onDeliveryAssign(order.id, defaultDeliveryId)
                                                onClose()
                                            } else {
                                                setShowSelfSelect(prev => !prev)
                                            }
                                        }}
                                        className="w-full text-left flex items-start gap-3"
                                    >
                                        <div className="w-10 h-10 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                                            <i className="bi bi-person-badge text-xl"></i>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-gray-900 text-sm">Autogestión</span>
                                                <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded bg-orange-100 text-orange-700">Tienda</span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                {defaultDeliveryId && availableDeliveries.some(d => d.id === defaultDeliveryId)
                                                    ? 'Asignar repartidor predeterminado de la tienda'
                                                    : 'Seleccionar repartidor propio de la tienda'}
                                            </p>
                                        </div>
                                    </button>

                                    {(showSelfSelect || !defaultDeliveryId || !availableDeliveries.some(d => d.id === defaultDeliveryId)) && canChangeDelivery && (
                                        <div className="mt-3 pt-3 border-t border-gray-200">
                                            <label className="block text-xs font-semibold text-gray-600 mb-1">Seleccionar repartidor propio:</label>
                                            <select
                                                value={order.delivery?.assignedDelivery || ''}
                                                onChange={async (e) => {
                                                    if (e.target.value) {
                                                        await onDeliveryAssign(order.id, e.target.value)
                                                        onClose()
                                                    }
                                                }}
                                                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
                                            >
                                                <option value="">Elegir repartidor...</option>
                                                {availableDeliveries.map(delivery => (
                                                    <option key={delivery.id} value={delivery.id}>{delivery.nombres}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>

                                {/* Opción Delivery Fuddi */}
                                <div className="p-4 rounded-xl border-2 border-gray-200 hover:border-blue-300 bg-white transition-all">
                                    <button
                                        type="button"
                                        disabled={isSearchingFuddi}
                                        onClick={async () => {
                                            setIsSearchingFuddi(true)
                                            try {
                                                if (onAutoAssignFuddi) {
                                                    await onAutoAssignFuddi(order)
                                                }
                                            } finally {
                                                setIsSearchingFuddi(false)
                                                onClose()
                                            }
                                        }}
                                        className="w-full text-left flex items-start gap-3"
                                    >
                                        <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                                            {isSearchingFuddi ? (
                                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                                            ) : (
                                                <i className="bi bi-scooter text-xl"></i>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-gray-900 text-sm">Delivery Fuddi</span>
                                                <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded bg-blue-100 text-blue-700">Red Fuddi</span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                Buscar repartidor de la red Fuddi automáticamente por zona de cobertura
                                            </p>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* Normal info when assigned or store has deliveryServiceType === 'self' */
                            <div className={`flex items-center gap-4 p-4 rounded-xl border ${agentCardClass}`}>
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${!order.delivery?.assignedDelivery ? 'bg-gray-100 text-gray-500' : status === 'accepted' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                    <i className="bi bi-person-fill text-2xl"></i>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs text-gray-500 font-medium">Repartidor Asignado</p>
                                    {canChangeDelivery ? (
                                        <select
                                            value={order.delivery?.assignedDelivery || ''}
                                            onChange={(e) => onDeliveryAssign(order.id, e.target.value)}
                                            className="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300"
                                        >
                                            <option value="">Asignar repartidor...</option>
                                            {availableDeliveries.map(delivery => (
                                                <option key={delivery.id} value={delivery.id}>{delivery.nombres}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <p className="text-lg font-bold text-gray-900 truncate">{deliveryAgent?.nombres || 'No identificado'}</p>
                                    )}
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className={`h-2 w-2 rounded-full ${!order.delivery?.assignedDelivery ? 'bg-gray-400' :
                                            status === 'accepted' ? 'bg-green-500' :
                                                status === 'rejected' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'
                                            }`} />
                                        <span className="text-sm font-bold text-gray-900">
                                            {!order.delivery?.assignedDelivery ? 'Sin asignar' :
                                                status === 'accepted' ? 'Confirmado' :
                                                    status === 'rejected' ? 'Rechazado' : 'Esperando confirmacion'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* WhatsApp Action */}
                        {order.delivery?.assignedDelivery && (
                            <button
                                onClick={onWhatsApp}
                                className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-200"
                            >
                                <i className="bi bi-whatsapp text-xl"></i>
                                Notificar por WhatsApp
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

const getActionIcon = (status: string) => {
    switch (status) {
        case 'preparing': return 'bi-fire text-purple-500'
        case 'ready': return 'bi-check2 text-green-600'
        case 'on_way': return 'bi-bicycle text-indigo-500'
        case 'delivered': return 'bi-stars text-purple-500'
        default: return 'bi-arrow-right'
    }
}

const getActionText = (status: string) => {
    switch (status) {
        case 'confirmed': return 'Confirmar'
        case 'preparing': return 'Preparando'
        case 'ready': return 'Listo para la entrega'
        case 'on_way': return 'En camino'
        case 'delivered': return 'Entregado'
        default: return getStatusText(status)
    }
}

function OrderStatusColumn({
    statuses,
    orders,
    availableDeliveries,
    handleStatusChange,
    handleDeliveryAssignment,
    handlePaymentClick,
    handleSendWhatsAppToDelivery,
    handlePrint,
    setSelectedOrderForStatusModal,
    setDeliveryStatusModalOpen,
    setSelectedOrderForEdit,
    setManualSidebarMode,
    setManualOrderSidebarOpen,
    handleDeleteOrder,
    setSelectedOrderForCustomerContact,
    setCustomerContactModalOpen,
    business,
    canChangeDelivery,
    canDeleteOrders,
    deliveryTimeMinutes,
    autoPrintOnConfirm,
    clientsWithNotes,
    businesses,
    selectedBusinessId
}: any) {
    return (
        <>
            {statuses.map((statusConfig: any) => {
                const groupedStatuses = typeof statusConfig === 'string' ? [statusConfig] : statusConfig.statuses;
                const sectionKey = typeof statusConfig === 'string' ? statusConfig : statusConfig.key;
                const sectionTitle = typeof statusConfig === 'string' ? getStatusText(statusConfig) : statusConfig.title;
                const sectionStatusColor = typeof statusConfig === 'string' ? statusConfig : statusConfig.statusColor || groupedStatuses[0];
                const sectionDefaultExpanded = typeof statusConfig === 'string' || statusConfig.defaultExpanded === undefined
                    ? !groupedStatuses.every((status: string) => ['delivered', 'cancelled'].includes(status))
                    : statusConfig.defaultExpanded;
                const statusOrders = orders.filter((o: any) => groupedStatuses.includes(o.status));
                const countStatusTotal = typeof statusConfig === 'string' || !statusConfig.countStatus
                    ? null
                    : statusOrders.filter((o: any) => o.status === statusConfig.countStatus).length;
                const sectionCount = countStatusTotal == null || countStatusTotal === statusOrders.length
                    ? statusOrders.length
                    : `${countStatusTotal} de ${statusOrders.length}`;
                if (statusOrders.length === 0) return null;

                return (
                    <CollapsibleSection
                        key={sectionKey}
                        title={sectionTitle}
                        count={sectionCount}
                        status={sectionStatusColor}
                        defaultExpanded={sectionDefaultExpanded}
                    >
                        {statusOrders.map((order: any) => {
                            const bizName = selectedBusinessId === 'all'
                                ? businesses?.find((b: any) => b.id === order.businessId)?.name
                                : undefined
                            return (
                                <OrderCard
                                    key={order.id}
                                    order={order}
                                    availableDeliveries={availableDeliveries}
                                    onStatusChange={handleStatusChange}
                                    onDeliveryAssign={handleDeliveryAssignment}
                                    onPaymentEdit={() => handlePaymentClick(order)}
                                    onWhatsAppDelivery={() => handleSendWhatsAppToDelivery(order)}
                                    onPrint={(silent?: boolean) => handlePrint(order, silent)}
                                    onDeliveryStatusClick={(o: any) => {
                                        setSelectedOrderForStatusModal(o)
                                        setDeliveryStatusModalOpen(true)
                                    }}
                                    onEdit={() => {
                                        setSelectedOrderForEdit(order)
                                        setManualSidebarMode('edit')
                                        setManualOrderSidebarOpen(true)
                                    }}
                                    onDelete={() => handleDeleteOrder(order.id)}
                                    onCustomerClick={() => {
                                        setSelectedOrderForCustomerContact(order)
                                        setCustomerContactModalOpen(true)
                                    }}
                                    sectionKey={sectionKey}
                                    businessPhone={business?.phone}
                                    canChangeDelivery={canChangeDelivery}
                                    canDeleteOrders={canDeleteOrders}
                                    deliveryTimeMinutes={deliveryTimeMinutes}
                                    autoPrintOnConfirm={autoPrintOnConfirm}
                                    clientsWithNotes={clientsWithNotes}
                                    businessName={bizName}
                                 />
                            )
                        })}
                    </CollapsibleSection>
                );
            })}
        </>
    );
}

function CollapsibleSection({
    title,
    count,
    status,
    children,
    defaultExpanded = true
}: {
    title: string,
    count: number | string,
    status: string,
    children: React.ReactNode,
    defaultExpanded?: boolean
}) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded)

    const getDotColor = (s: string) => {
        switch (s) {
            case 'pending': return 'bg-yellow-500 shadow-yellow-200'
            case 'borrador': return 'bg-orange-400 shadow-orange-200'
            case 'confirmed': return 'bg-blue-500 shadow-blue-200'
            case 'preparing': return 'bg-purple-500 shadow-purple-200'
            case 'ready': return 'bg-green-500 shadow-green-200'
            case 'on_way': return 'bg-indigo-500 shadow-indigo-200'
            case 'delivered': return 'bg-gray-500 shadow-gray-200'
            case 'cancelled': return 'bg-red-500 shadow-red-200'
            default: return 'bg-gray-400'
        }
    }

    return (
        <div className="mb-4 overflow-visible rounded-xl bg-transparent">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-3 flex justify-between items-center bg-gray-100 hover:bg-gray-200 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full shadow-sm ${getDotColor(status)}`}></span>
                    <h3 className="font-bold text-gray-800 text-lg">{title}</h3>
                    <span className="bg-gray-200 border border-gray-300 text-gray-700 text-xs font-bold px-2.5 py-0.5 rounded-full">{count}</span>
                </div>
                <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 transition-transform duration-200`}></i>
            </button>

            {isExpanded && (
                <div className="p-4 space-y-3 bg-gray-100 animate-in slide-in-from-top-2 duration-200">
                    {children}
                </div>
            )}
        </div>
    )
}

function OrderCard({
    order,
    availableDeliveries,
    onStatusChange,
    onDeliveryAssign,
    onPaymentEdit,
    onWhatsAppDelivery,
    onPrint,
    onDeliveryStatusClick,
    onEdit,
    onDelete,
    onCustomerClick,
    sectionKey,
    businessPhone,
    canChangeDelivery,
    canDeleteOrders,
    deliveryTimeMinutes,
    autoPrintOnConfirm,
    clientsWithNotes,
    businessName
}: {
    order: Order,
    availableDeliveries: Delivery[],
    onStatusChange: (id: string, status: Order['status'], reason?: string) => void,
    onDeliveryAssign: (id: string, deliveryId: string) => void,
    onPaymentEdit: () => void,
    onWhatsAppDelivery: () => void,
    onPrint: (silent?: boolean) => void,
    onDeliveryStatusClick: (order: Order) => void,
    onEdit: () => void,
    onDelete: () => void,
    onCustomerClick: () => void,
    sectionKey?: string,
    businessPhone?: string,
    canChangeDelivery?: boolean,
    canDeleteOrders?: boolean,
    deliveryTimeMinutes?: number,
    autoPrintOnConfirm?: boolean,
    clientsWithNotes?: Record<string, string>,
    businessName?: string
}) {
    const nextStatus = getNextStatus(order.status)
    const getOrderTargetDate = () => {
        const date = order.timing?.scheduledDate
            ? toSafeDate(order.timing.scheduledDate)
            : toSafeDate(order.createdAt)

        if (order.timing?.scheduledTime) {
            const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number)
            if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
                date.setHours(hours, minutes, 0, 0)
            }
        }

        return date
    }
    const isWithinDeliveryTimeWindow = () => {
        if (!['confirmed', 'preparing'].includes(order.status)) return false
        const windowMinutes = deliveryTimeMinutes ?? 30
        const diffMinutes = (getOrderTargetDate().getTime() - Date.now()) / 60000
        return diffMinutes <= windowMinutes
    }
    const showReadyAction = ['confirmed', 'preparing'].includes(order.status) && isWithinDeliveryTimeWindow()
    const primaryActionStatus = showReadyAction ? 'ready' : (order.status === 'confirmed' ? null : nextStatus)
    const primaryActionLabel = showReadyAction ? '¿Pedido listo?' : (primaryActionStatus ? getActionText(primaryActionStatus) : '')
    const isDelivery = order.delivery?.type === 'delivery'
    const isPickup = order.delivery?.type === 'pickup'
    const [isExpanded, setIsExpanded] = useState(false)
    const [statusMenuOpen, setStatusMenuOpen] = useState(false)
    const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
    const [discardReason, setDiscardReason] = useState('')
    const [deliveryInfoExpanded, setDeliveryInfoExpanded] = useState(false)
    const statusMenuRef = useRef<HTMLDivElement>(null)
    const assignedDelivery = availableDeliveries.find(d => d.id === order.delivery?.assignedDelivery)
    const deliveryLabel = order.delivery?.assignedDelivery
        ? assignedDelivery?.nombres || 'Delivery asignado'
        : 'Buscando delivery'
    const deliveryLabelClass = !order.delivery?.assignedDelivery
        ? 'bg-gray-100 text-gray-600 border-gray-200'
        : order.delivery?.acceptanceStatus === 'accepted'
            ? 'bg-green-100 text-green-700 border-green-200'
            : 'bg-yellow-100 text-yellow-800 border-yellow-200'
    const deliveryLabelTitle = !order.delivery?.assignedDelivery
        ? 'Buscando delivery'
        : order.delivery?.acceptanceStatus === 'accepted'
            ? 'Delivery confirmado'
            : 'Esperando confirmacion del delivery'
    const fulfillmentLabel = isPickup ? 'Retiro en tienda' : deliveryLabel
    const fulfillmentLabelClass = isPickup ? 'bg-blue-100 text-blue-700 border-blue-200' : deliveryLabelClass
    const fulfillmentLabelTitle = isPickup ? 'Retiro en tienda' : deliveryLabelTitle
    const showInlineStatusTag = sectionKey === 'delivered-group'
    const inlineStatusClass = order.status === 'ready'
        ? 'bg-green-50 text-green-700 border-green-200'
        : order.status === 'on_way'
            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
            : 'bg-gray-100 text-gray-700 border-gray-200'
    const deliveryCoordinates = getDeliveryCoordinates(order)
    const deliveryZone = getDeliveryZone(order)
    const deliveryCost = order.delivery?.deliveryCost || 0
    const deliveryMapsUrl = deliveryCoordinates
        ? `https://www.google.com/maps/search/?api=1&query=${deliveryCoordinates.lat},${deliveryCoordinates.lng}`
        : undefined
    const deliveryMapImageUrl = deliveryCoordinates
        ? `https://maps.googleapis.com/maps/api/staticmap?center=${deliveryCoordinates.lat},${deliveryCoordinates.lng}&zoom=16&size=600x180&scale=2&maptype=roadmap&markers=color:red%7C${deliveryCoordinates.lat},${deliveryCoordinates.lng}&key=${GOOGLE_MAPS_API_KEY}`
        : undefined

    useEffect(() => {
        if (confirmDiscardOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
        }
        return () => {
            document.body.style.overflow = ''
        }
    }, [confirmDiscardOpen])

    useEffect(() => {
        if (!statusMenuOpen) return

        const handleClickOutside = (event: MouseEvent) => {
            if (!statusMenuRef.current?.contains(event.target as Node)) {
                setStatusMenuOpen(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [statusMenuOpen])

    const isUrgent = () => {
        if (['ready', 'delivered', 'completed', 'cancelled'].includes(order.status)) return false;

        const now = new Date();
        let targetDate = new Date();

        if (order.timing?.scheduledTime) {
            const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number);
            targetDate.setHours(hours, minutes, 0, 0);
        } else {
            return false;
        }

        const diffInMinutes = (targetDate.getTime() - now.getTime()) / 60000;
        return diffInMinutes <= 5;
    }

    const urgent = isUrgent();

    const sortedItems = [...(order.items || [])].sort((a: any, b: any) => {
        const priceA = (a.price || a.product?.price || 0) * a.quantity;
        const priceB = (b.price || b.product?.price || 0) * b.quantity;

        if (priceA === 0 && priceB !== 0) return 1;
        if (priceA !== 0 && priceB === 0) return -1;
        return 0;
    });

    return (
        <div className={`bg-white rounded-xl shadow-sm border border-gray-100 transition-all ${statusMenuOpen ? 'relative z-30' : ''} ${urgent ? 'animate-pulse border-red-300 ring-2 ring-red-100' : ''}`}>
            {confirmDiscardOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
                        onClick={() => {
                            setConfirmDiscardOpen(false)
                            setDiscardReason('')
                        }}
                    />

                    <div className="relative bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
                        <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mb-4">
                            <i className="bi bi-trash3 text-2xl"></i>
                        </div>

                        <h4 className="text-xl font-bold text-gray-900 mb-2">¿Descartar pedido?</h4>
                        <p className="text-sm text-gray-500 mb-6 px-2">
                            Se marcará como descartado y desaparecerá de la lista activa. Por favor selecciona el motivo.
                        </p>

                        <div className="w-full mb-6">
                            <label className="block text-xs uppercase tracking-wider text-gray-400 font-bold mb-2 text-left ml-1">
                                Motivo del descarte
                            </label>
                            <select
                                value={discardReason}
                                onChange={(e) => setDiscardReason(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-sm outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300 transition-all font-medium"
                            >
                                <option value="">Selecciona un motivo...</option>
                                <option value="Cliente no responde">Cliente no responde</option>
                                <option value="Sin stock de productos">Sin stock de productos</option>
                                <option value="Fuera de zona de cobertura">Fuera de zona de cobertura</option>
                                <option value="Pedido duplicado">Pedido duplicado</option>
                                <option value="Fallo en el pago">Fallo en el pago</option>
                                <option value="Otro">Otro motivo</option>
                            </select>
                        </div>

                        <div className="flex gap-3 w-full">
                            <button
                                onClick={() => {
                                    setConfirmDiscardOpen(false)
                                    setDiscardReason('')
                                }}
                                className="flex-1 py-3 text-sm font-bold text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    onStatusChange(order.id, 'cancelled', discardReason || 'Sin motivo especificado')
                                    setConfirmDiscardOpen(false)
                                    setDiscardReason('')
                                    setStatusMenuOpen(false)
                                }}
                                className="flex-1 py-3 text-sm font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                                disabled={!discardReason}
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Card Header: Customer info & time */}
            <div
                className={`px-4 py-3 border-b cursor-pointer transition-colors ${isExpanded ? 'border-gray-200 bg-gray-200 hover:bg-gray-200' : 'border-gray-50 bg-gray-55/50 hover:bg-gray-100'}`}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-3">
                        <div className="flex flex-col items-center shrink-0 mt-1 mr-1">
                            <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 text-xs transform transition-transform duration-200`}></i>
                            {!order.createdByAdmin && (
                                <i className="bi bi-phone text-blue-500 text-[10px] mt-0.5" title="Pedido del cliente (Checkout)"></i>
                            )}
                        </div>

                        <div className="flex flex-col">
                            <span className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                                {order.customer?.name || "Cliente"}
                                {order.customer?.phone && clientsWithNotes && clientsWithNotes[order.customer.phone] && (
                                    <i 
                                        className="bi bi-exclamation-circle-fill text-amber-500 animate-pulse cursor-help" 
                                        title={`Nota de cliente: ${clientsWithNotes[order.customer.phone]}`}
                                    ></i>
                                )}
                            </span>
                            {businessName && (
                                <span className="text-[10px] text-red-600 font-bold uppercase tracking-wider mb-0.5 leading-none">
                                    {businessName}
                                </span>
                            )}

                            <div className="flex items-center gap-2 mt-0.5">
                                <i className={`bi ${order.timing?.type === 'scheduled' ? 'bi-clock text-blue-600' : 'bi-lightning-fill text-yellow-500'}`}></i>
                                <span className="font-mono text-sm sm:font-medium text-gray-600">
                                    {getOrderDisplayTime(order)}
                                </span>
                                {isPreviousActiveOrder(order) && (
                                    <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold leading-none bg-amber-100 text-amber-800 border border-amber-200">
                                        Pendiente anterior
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        {primaryActionStatus && (
                            <button
                                onClick={() => {
                                    if (primaryActionStatus === 'confirmed') {
                                        onStatusChange(order.id, 'confirmed');
                                        if (autoPrintOnConfirm) {
                                            setTimeout(() => {
                                                onPrint(true);
                                            }, 500);
                                        }
                                    } else {
                                        onStatusChange(order.id, primaryActionStatus);
                                    }
                                }}
                                className={`flex items-center gap-1 rounded-lg transition-colors ${showReadyAction
                                    ? 'px-2 py-1.5 text-xs font-bold text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                                    : primaryActionStatus === 'confirmed'
                                        ? 'px-3 py-1.5 text-xs font-bold bg-green-600 text-white hover:bg-green-700 shadow-sm'
                                        : 'p-1.5 text-lg hover:bg-white hover:shadow-md'
                                    }`}
                                title={primaryActionLabel}
                            >
                                {(primaryActionStatus === 'confirmed' || showReadyAction) ? (
                                    <>
                                        <span>{primaryActionLabel}</span>
                                        {!showReadyAction && <i className="bi bi-check2-circle"></i>}
                                    </>
                                ) : (
                                    <i className={`bi ${getActionIcon(primaryActionStatus)}`}></i>
                                )}
                            </button>
                        )}

                        {order.status === 'pending' && (
                            <button
                                onClick={() => setConfirmDiscardOpen(true)}
                                className="p-1.5 text-lg text-gray-400 bg-gray-50 border border-gray-100 rounded-lg hover:bg-gray-100 transition-colors shadow-sm"
                                title="Descartar pedido"
                            >
                                <i className="bi bi-x-lg"></i>
                            </button>
                        )}

                        {showInlineStatusTag ? (
                            <span
                                className={`inline-flex h-7 items-center rounded-lg border px-2 text-[11px] font-bold leading-none ${inlineStatusClass}`}
                                title={getStatusText(order.status)}
                            >
                                {getStatusText(order.status)}
                            </span>
                        ) : order.status !== 'pending' &&
                            <div className="relative" ref={statusMenuRef}>
                                <button
                                    onClick={() => setStatusMenuOpen(!statusMenuOpen)}
                                    className={`p-1.5 text-lg rounded-lg transition-all hover:bg-gray-100 ${statusMenuOpen ? 'bg-gray-100' : ''}`}
                                    title="Cambiar estado"
                                >
                                    <i className="bi bi-three-dots-vertical"></i>
                                </button>

                                {statusMenuOpen &&
                                    <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-20 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                                        <button
                                            onClick={() => {
                                                onStatusChange(order.id, 'preparing')
                                                setStatusMenuOpen(false)
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2"
                                        >
                                            <i className="bi bi-fire text-purple-500"></i>
                                            Preparando
                                        </button>
                                        <button
                                            onClick={() => {
                                                onStatusChange(order.id, 'ready')
                                                setStatusMenuOpen(false)
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2"
                                        >
                                            <i className="bi bi-box-seam text-green-500"></i>
                                            Listo para entrega
                                        </button>
                                        <button
                                            onClick={() => {
                                                onStatusChange(order.id, 'delivered')
                                                setStatusMenuOpen(false)
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2"
                                        >
                                            <i className="bi bi-check-all text-gray-500"></i>
                                            Entregado
                                        </button>
                                        <button
                                            onClick={() => {
                                                setConfirmDiscardOpen(true)
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2 border-t border-gray-50 mt-1"
                                        >
                                            <i className="bi bi-x-circle text-gray-500"></i>
                                            Descartado
                                        </button>
                                    </div>
                                }
                            </div>
                        }
                    </div>
                </div>

                {!isExpanded && (
                    <div className="flex flex-col gap-0.5">
                        {sortedItems.map((item: any, idx) => (
                            <div key={idx} className="text-lg sm:text-sm leading-tight text-gray-600">
                                {item.quantity}x {item.variant || item.product?.name || item.name}
                            </div>
                        ))}
                    </div>
                )}

                {(isDelivery || isPickup) && (
                    <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            onClick={() => {
                                if (isDelivery) {
                                    onDeliveryStatusClick(order)
                                }
                            }}
                            className={`flex h-[20px] min-h-[20px] max-h-[20px] w-36 items-center justify-center truncate rounded-[3px] border px-2 py-0 text-[11px] font-semibold leading-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] transition-colors ${fulfillmentLabelClass} ${isDelivery ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}`}
                            title={fulfillmentLabelTitle}
                        >
                            {fulfillmentLabel}
                        </button>
                    </div>
                )}
            </div>

            {/* Card Body */}
            {isExpanded && (
                <div className="p-4 bg-white animate-in slide-in-from-top-2 duration-200">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex-1 pr-2">
                            {isDelivery && (
                                <div className="space-y-2">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setDeliveryInfoExpanded(prev => !prev)
                                        }}
                                        className="group flex w-full max-w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-gray-600 transition-colors hover:bg-red-50 hover:text-red-700"
                                        title={deliveryInfoExpanded ? 'Ocultar datos de entrega' : 'Ver datos de entrega'}
                                        aria-expanded={deliveryInfoExpanded}
                                    >
                                        <i className="bi bi-geo-alt-fill mt-0.5 flex-shrink-0 text-gray-400 group-hover:text-red-500"></i>
                                        <span className="line-clamp-2">{order.delivery?.references || (order.delivery as any)?.reference || "Ubicación"}</span>
                                        <i className={`bi bi-chevron-${deliveryInfoExpanded ? 'up' : 'down'} mt-0.5 flex-shrink-0 text-[11px] text-gray-300 group-hover:text-red-500`}></i>
                                    </button>
                                    
                                    {deliveryInfoExpanded && (
                                        <div className="ml-2 overflow-hidden rounded-xl border border-red-100 bg-red-50/50 animate-in slide-in-from-top-1 duration-150">
                                            {deliveryMapImageUrl && deliveryMapsUrl ? (
                                                <a
                                                    href={deliveryMapsUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="block"
                                                    title="Abrir ubicación en Maps"
                                                >
                                                    <img
                                                        src={deliveryMapImageUrl}
                                                        alt="Mapa de entrega"
                                                        className="h-36 w-full object-cover"
                                                        loading="lazy"
                                                    />
                                                </a>
                                            ) : (
                                                <div className="flex h-24 items-center justify-center gap-2 text-sm font-medium text-gray-500">
                                                    <i className="bi bi-map text-gray-300"></i>
                                                    Sin coordenadas
                                                </div>
                                            )}

                                            <div className="grid grid-cols-2 gap-2 p-3 text-sm">
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Zona</p>
                                                    <p className="font-semibold text-gray-900">{deliveryZone}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Envío</p>
                                                    <p className="font-semibold text-gray-900">${deliveryCost.toFixed(2)}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {order.notas && order.notas.trim() && (
                        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <div className="flex items-start gap-2">
                                <i className="bi bi-sticky text-amber-600 mt-0.5 flex-shrink-0"></i>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-amber-800 mb-1">Notas</p>
                                    <p className="text-sm text-amber-700 whitespace-pre-wrap">{order.notas}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {order.notaImageUrl && (
                        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <div className="flex items-start gap-2">
                                <i className="bi bi-image text-amber-600 mt-0.5 flex-shrink-0"></i>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-amber-800 mb-2">Imagen de nota</p>
                                    <img src={order.notaImageUrl} alt="Imagen de nota" className="max-h-48 w-full object-contain rounded-md border border-amber-200 bg-white" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Product items list */}
                    <div className="space-y-2 mb-4">
                        {order.items?.map((item: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-base">
                                <span className="text-gray-700">
                                    <span className="font-medium text-gray-900">{item.quantity}x</span> {item.variant || item.product?.name || item.name}
                                </span>
                                <div className="flex flex-col items-end">
                                    <span className="text-emerald-600 font-bold text-sm">
                                        ${((item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0))) * item.quantity).toFixed(2)}
                                    </span>
                                    {((item.price || item.product?.price || 0) > (item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0)))) && (
                                        <span className="text-[9px] text-gray-400 font-medium">Público: ${((item.price || item.product?.price || 0) * item.quantity).toFixed(2)}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-dashed border-gray-200 my-3"></div>

                    {/* Total info */}
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={onPaymentEdit}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm font-medium transition-colors ${order.payment?.paymentStatus === 'paid'
                                    ? 'bg-green-100 text-green-700'
                                    : order.payment?.paymentStatus === 'validating'
                                        ? 'bg-yellow-100 text-yellow-700'
                                        : 'bg-red-100 text-red-700'
                                    }`}
                            >
                                <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-bank' :
                                    order.payment?.method === 'mixed' ? 'bi-cash-coin' : 'bi-cash'
                                    }`}></i>
                                <div className="flex flex-col items-start leading-tight">
                                    <span className="text-emerald-600 font-black">${(order.items?.reduce((acc, item) => acc + ((item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0))) * item.quantity), 0) || order.total || 0).toFixed(2)}</span>
                                    {((order.total || 0) > (order.items?.reduce((acc, item) => acc + ((item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0))) * item.quantity), 0) || order.total || 0)) && (
                                        <span className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter">Público: ${(order.total || 0).toFixed(2)}</span>
                                    )}
                                </div>
                                <i className="bi bi-pencil-square text-xs opacity-50 ml-1"></i>
                            </button>
                        </div>

                        <button
                            onClick={() => onPrint()}
                            className="p-2 text-gray-400 hover:text-gray-600"
                            title="Imprimir ticket"
                        >
                            <i className="bi bi-printer"></i>
                        </button>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-4 border-t border-gray-100">
                        <a
                            href="#"
                            onClick={(e) => { e.preventDefault(); onCustomerClick(); }}
                            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors cursor-pointer"
                        >
                            <i className="bi bi-whatsapp"></i>
                            Enviar comprobante
                        </a>
                        
                        <button
                            onClick={onEdit}
                            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                            <i className="bi bi-pencil"></i>
                            Editar
                        </button>
                        
                        {canDeleteOrders && (
                            <button
                                onClick={onDelete}
                                className="flex items-center justify-center p-2 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                                title="Eliminar pedido"
                            >
                                <i className="bi bi-trash"></i>
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
