'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Business, Order, Delivery, Product } from '@/types'
import { useBusinessAuth } from '@/contexts/BusinessAuthContext'
import { db } from '@/lib/firebase'
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import {
    getBusiness,
    getProductsByBusiness,
    deleteOrder,
    getCoverageZones,
    isPointInPolygon,
    getDeliveriesByStatus,
    updateOrderStatus,
    updateBusiness,
    getUserBusinessAccess,
    getTodayVisitsDocRef,
    getHistoricalOrdersByBusiness,
    getOrdersByBusinessComplete,
    uploadImage,
    addBusinessAdministrator,
    removeBusinessAdministrator
} from '@/lib/database'
import {
    sendWhatsAppToDelivery,
    sendWhatsAppToCustomer,
    getNextStatus
} from '@/components/WhatsAppUtils'
import { printOrder } from '@/lib/print-utils'
import { isStoreOpen } from '@/lib/store-utils'
import QueueStatusIndicator from '@/components/QueueStatusIndicator'
import NotificationsBell from '@/components/NotificationsBell'
import { useOfflineQueue } from '@/hooks/useOfflineQueue'
import { auth } from '@/lib/firebase'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import DashboardSidebar from '@/components/DashboardSidebar'
import ProductList from '@/components/ProductList'
import DayPreflightChecklist from '@/components/DayPreflightChecklist'

// Helper function to check point in polygon (if not imported, but we added it to imports above)
// If isPointInPolygon is not exported from @/lib/database, we might need to define it here or import it.
// Assuming it is exported based on dashboard/page.tsx usage.

// dynamic loading for history
const OrderHistory = dynamic(() => import('@/components/OrderHistory'), {
    loading: () => (
        <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
        </div>
    ),
    ssr: false
})

// Lazy-loaded SPA tab components
const StatisticsView = dynamic(() => import('@/components/StatisticsView'), { ssr: false })
const WalletView = dynamic(() => import('@/components/WalletView'), { ssr: false })
const IngredientStockManagement = dynamic(() => import('@/components/IngredientStockManagement'), { ssr: false })
const CostReports = dynamic(() => import('@/components/CostReports'), { ssr: false })
const BusinessProfileDashboard = dynamic(() => import('@/components/BusinessProfileDashboard'), { ssr: false })
const BusinessProfileEditor = dynamic(() => import('@/components/BusinessProfileEditor'), { ssr: false })

// Auto-assign logic
const autoAssignDeliveryForOrder = async (order: Order): Promise<string | undefined> => {
    try {
        const deliveries = await getDeliveriesByStatus('activo');
        let assignedDeliveryId: string | undefined = undefined;

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



import PaymentManagementModals from '@/components/PaymentManagementModals'
import ManualOrderSidebar from '@/components/ManualOrderSidebar'
import { LiveCheckoutsPanel } from '@/components/LiveCheckoutsPanel'

const getStatusText = (status: string) => {
    switch (status) {
        case 'pending': return 'Pendiente'
        case 'confirmed': return 'Confirmado'
        case 'preparing': return 'Preparando'
        case 'ready': return 'Listo para entrega'
        case 'on_way': return 'En camino'
        case 'delivered': return 'Entregado'
        case 'cancelled': return 'Cancelado'
        default: return status
    }
}

const getStatusColor = (status: string) => {
    switch (status) {
        case 'pending': return 'bg-yellow-100 text-yellow-800'
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
    if (val.seconds) return new Date(val.seconds * 1000)
    if (typeof val === 'string') return new Date(val)
    if (val instanceof Date) return val
    return new Date()
}

// Helper to get the display time for an order
const getOrderDisplayTime = (order: Order) => {
    try {
        if (order.timing?.scheduledTime) {
            return order.timing.scheduledTime; // Already formatted as HH:MM
        }
        const date = toSafeDate(order.createdAt);
        return date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '--:--';
    }
}

export default function TodayOrdersPage() {
    const router = useRouter()
    const { businessId, isAuthenticated, authLoading, logout, user, setBusinessId } = useBusinessAuth()

    // Dashboard Header State
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [businesses, setBusinesses] = useState<Business[]>([])
    const [showBusinessDropdown, setShowBusinessDropdown] = useState(false)
    const [showTimeDropdown, setShowTimeDropdown] = useState(false)
    const [updatingStoreStatus, setUpdatingStoreStatus] = useState(false)
    const [updatingDeliveryTime, setUpdatingDeliveryTime] = useState(false)
    const { queueStatus, retryFailed } = useOfflineQueue()

    // Notifications Hook
    const pushNotifications = usePushNotifications()
    const {
        permission = 'default',
        requestPermission = () => Promise.resolve('default'),
        showNotification = (options: { title: string; body: string; icon?: string }) =>
            console.log('Notificación simulada:', options),
        isSupported = false,
        isIOS = false,
        needsUserAction = false
    } = pushNotifications || {} as any

    // Sidebar State
    const [activeTab, setActiveTab] = useState<'orders' | 'profile' | 'admins' | 'reports' | 'inventory' | 'qrcodes' | 'stats' | 'wallet' | 'checklist'>('orders')
    const [profileSubTab, setProfileSubTab] = useState<'general' | 'products' | 'fidelizacion' | 'notifications' | 'admins'>('general')
    const [reportsSubTab, setReportsSubTab] = useState<'general' | 'deliveries' | 'costs'>('general')
    const [isTiendaMenuOpen, setIsTiendaMenuOpen] = useState(false)
    const [isReportsMenuOpen, setIsReportsMenuOpen] = useState(false)

    // Read tab from URL on mount (deep-link support)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const tab = params.get('tab')
        if (tab) {
            setActiveTab(tab as any)
            const pSub = params.get('profileSubTab')
            if (pSub) setProfileSubTab(pSub as any)
            const rSub = params.get('reportsSubTab')
            if (rSub) setReportsSubTab(rSub as any)
        }
    }, [])

    // activeTab removed (was 'orders') - now we use orders state directly
    const [orders, setOrders] = useState<Order[]>([])
    const [loading, setLoading] = useState(true)
    const [availableDeliveries, setAvailableDeliveries] = useState<Delivery[]>([])
    const [business, setBusiness] = useState<Business | null>(null)
    const [products, setProducts] = useState<Product[]>([])

    // Sub-tab state for Orders
    const [ordersSubTab, setOrdersSubTab] = useState<'today' | 'history'>('today')
    const [historicalOrders, setHistoricalOrders] = useState<Order[]>([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [historyLoaded, setHistoryLoaded] = useState(false)

    // ... existing modal states ...
    const [paymentModalOpen, setPaymentModalOpen] = useState(false)
    const [selectedOrderForPayment, setSelectedOrderForPayment] = useState<Order | null>(null)

    const [deliveryStatusModalOpen, setDeliveryStatusModalOpen] = useState(false)
    const [selectedOrderForStatusModal, setSelectedOrderForStatusModal] = useState<Order | null>(null)

    const [manualOrderSidebarOpen, setManualOrderSidebarOpen] = useState(false)
    const [manualSidebarMode, setManualSidebarMode] = useState<'create' | 'edit'>('create')
    const [selectedOrderForEdit, setSelectedOrderForEdit] = useState<Order | null>(null)

    const [customerContactModalOpen, setCustomerContactModalOpen] = useState(false)
    const [selectedOrderForCustomerContact, setSelectedOrderForCustomerContact] = useState<Order | null>(null)

    // ProductList specific state
    const [categories, setCategories] = useState<string[]>([])
    const [productsLoaded, setProductsLoaded] = useState(false)
    const [productsLoading, setProductsLoading] = useState(false)

    useEffect(() => {
        if (business?.categories) {
            setCategories(business.categories)
        }
    }, [business])

    const handleProductsChange = (newProducts: Product[]) => {
        setProducts(newProducts)
    }

    const handleCategoriesChange = (newCategories: string[]) => {
        setCategories(newCategories)
    }

    const handleDirectUpdate = async (field: keyof Business, value: any) => {
        if (!business?.id) return
        try {
            await updateBusiness(business.id, { [field]: value })
            setBusiness(prev => prev ? { ...prev, [field]: value } : null)
        } catch (error) {
            console.error("Error updating business", error)
        }
    }

    // === Profile Editing State (for BusinessProfileDashboard) ===
    const [editedBusiness, setEditedBusiness] = useState<Business | null>(null)
    const [isEditingProfile, setIsEditingProfile] = useState(false)
    const [uploadingCover, setUploadingCover] = useState(false)
    const [uploadingProfile, setUploadingProfile] = useState(false)
    const [uploadingLocation, setUploadingLocation] = useState(false)
    const [userRole, setUserRole] = useState<'owner' | 'admin' | 'manager' | null>(null)
    const [savingProfile, setSavingProfile] = useState(false)

    // Determine user role
    useEffect(() => {
        if (!business || !user) return
        const isOwner = business.ownerId === user.uid
        if (isOwner) {
            setUserRole('owner')
        } else {
            const adminEntry = business.administrators?.find(a => a.email === user.email)
            setUserRole(adminEntry?.role as any || 'admin')
        }
    }, [business, user])

    const handleEditProfile = () => {
        setIsEditingProfile(true)
        setEditedBusiness(business ? { ...business } : null)
    }

    const handleCancelEdit = () => {
        setIsEditingProfile(false)
        setEditedBusiness(null)
    }

    const handleSaveProfile = async () => {
        if (!editedBusiness) return
        try {
            await updateBusiness(editedBusiness.id, editedBusiness)
            setBusiness(editedBusiness)
            setBusinesses(prev => prev.map(b => b.id === editedBusiness.id ? editedBusiness : b))
            setIsEditingProfile(false)
            setEditedBusiness(null)
            alert('Información actualizada exitosamente')
        } catch (error) {
            alert('Error al guardar los cambios. Inténtalo de nuevo.')
        }
    }

    const handleBusinessFieldChange = (field: keyof Business, value: any) => {
        if (!editedBusiness) return
        setEditedBusiness({ ...editedBusiness, [field]: value })
    }

    const handleScheduleFieldChange = (day: string, key: 'open' | 'close' | 'isOpen', value: any) => {
        if (!editedBusiness) return
        const schedule = editedBusiness.schedule ? { ...editedBusiness.schedule } : {} as any
        const dayObj = schedule[day] ? { ...schedule[day] } : { open: '09:00', close: '18:00', isOpen: true }
        dayObj[key] = value
        schedule[day] = dayObj
        setEditedBusiness({ ...editedBusiness, schedule })
    }

    const handleToggleDayOpen = (day: string) => {
        if (!editedBusiness) return
        const schedule = editedBusiness.schedule ? { ...editedBusiness.schedule } : {} as any
        const dayObj = schedule[day] ? { ...schedule[day] } : { open: '09:00', close: '18:00', isOpen: true }
        dayObj.isOpen = !dayObj.isOpen
        schedule[day] = dayObj
        setEditedBusiness({ ...editedBusiness, schedule })
    }

    const handleCoverImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file || !business) return
        setUploadingCover(true)
        try {
            const path = `businesses/covers/${business.id}_${Date.now()}_${file.name}`
            const imageUrl = await uploadImage(file, path)
            await updateBusiness(business.id, { coverImage: imageUrl })
            const updatedBusiness = { ...business, coverImage: imageUrl }
            setBusiness(updatedBusiness)
            if (editedBusiness?.id === business.id) setEditedBusiness({ ...editedBusiness, coverImage: imageUrl })
            setBusinesses(prev => prev.map(b => b.id === business.id ? updatedBusiness : b))
        } catch (error) {
            alert('Error al subir la imagen de portada.')
        } finally {
            setUploadingCover(false)
        }
    }

    const handleProfileImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file || !business) return
        setUploadingProfile(true)
        try {
            const path = `businesses/profiles/${business.id}_${Date.now()}_${file.name}`
            const imageUrl = await uploadImage(file, path)
            await updateBusiness(business.id, { image: imageUrl })
            const updatedBusiness = { ...business, image: imageUrl }
            setBusiness(updatedBusiness)
            if (editedBusiness?.id === business.id) setEditedBusiness({ ...editedBusiness, image: imageUrl })
            setBusinesses(prev => prev.map(b => b.id === business.id ? updatedBusiness : b))
        } catch (error) {
            alert('Error al subir la imagen de perfil.')
        } finally {
            setUploadingProfile(false)
        }
    }

    const handleLocationImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file || !business) return
        setUploadingLocation(true)
        try {
            const path = `businesses/locations/${business.id}_${Date.now()}_${file.name}`
            const imageUrl = await uploadImage(file, path)
            await updateBusiness(business.id, { locationImage: imageUrl })
            const updatedBusiness = { ...business, locationImage: imageUrl }
            setBusiness(updatedBusiness)
            if (editedBusiness?.id === business.id) setEditedBusiness({ ...editedBusiness, locationImage: imageUrl })
            setBusinesses(prev => prev.map(b => b.id === business.id ? updatedBusiness : b))
        } catch (error) {
            alert('Error al subir la foto del local.')
        } finally {
            setUploadingLocation(false)
        }
    }

    const handleRemoveAdmin = async (adminEmail: string) => {
        if (!business || !confirm('¿Estás seguro de que quieres remover este administrador?')) return
        try {
            await removeBusinessAdministrator(business.id, adminEmail)
            const updatedBusiness = await getBusiness(business.id)
            if (updatedBusiness) {
                setBusiness(updatedBusiness)
                setBusinesses(prev => prev.map(b => b.id === business.id ? updatedBusiness : b))
            }
            alert('Administrador removido exitosamente')
        } catch (error: any) {
            alert(error.message || 'Error al remover administrador')
        }
    }

    const handleTransferOwnership = async (admin: any) => {
        if (!business || !user) return
        if (!admin.uid) {
            alert('Este administrador aún no ha vinculado su cuenta. No se puede transferir la propiedad.')
            return
        }
        if (!confirm(`¿Estás SEGURO de que quieres transferir la propiedad de "${business.name}" a ${admin.email}?`)) return
        try {
            const { transferBusinessOwnership } = await import('@/lib/database')
            await transferBusinessOwnership(business.id, admin.email, admin.uid, user.uid, user.email || '')
            alert('¡Propiedad transferida exitosamente! El dashboard se recargará.')
            window.location.reload()
        } catch (error: any) {
            alert(error.message || 'Error al transferir propiedad')
        }
    }

    // Handler for BusinessProfileEditor (Generales tab)
    const handleSaveProfileGeneral = async (updatedData: Partial<Business>) => {
        if (!business) return
        setSavingProfile(true)
        try {
            await updateBusiness(business.id, { ...updatedData, updatedAt: new Date() })
            setBusiness(prev => prev ? { ...prev, ...updatedData } : null)
            alert('Información actualizada exitosamente')
        } catch (error) {
            alert('Error al guardar los cambios. Inténtalo de nuevo.')
        } finally {
            setSavingProfile(false)
        }
    }

    // Auth protection
    useEffect(() => {
        if (!authLoading && !isAuthenticated) {
            router.replace('/business/login')
        }
    }, [authLoading, isAuthenticated, router])

    // Fetch business data
    useEffect(() => {
        if (!businessId) return
        const fetchBusiness = async () => {
            try {
                const businessData = await getBusiness(businessId)
                setBusiness(businessData)
            } catch (error) {
                console.error("Error fetching business", error)
            }
        }
        fetchBusiness()
    }, [businessId])

    // Load visits count
    const [visitsCount, setVisitsCount] = useState(0)

    useEffect(() => {
        if (!businessId) return

        const visitRef = getTodayVisitsDocRef(businessId)
        const unsubscribe = onSnapshot(visitRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data()
                setVisitsCount(data.count || 0)
            } else {
                setVisitsCount(0)
            }
        }, (error) => {
            console.error("Error listening to visits:", error)
        })

        return () => unsubscribe()
    }, [businessId])

    // Fetch products (Lazy loading)
    useEffect(() => {
        // Reset products state when business changes
        setProductsLoaded(false)
        setProducts([])
    }, [businessId])

    useEffect(() => {
        if (!businessId) return

        const shouldLoad = (activeTab === 'profile' && profileSubTab === 'products') || manualOrderSidebarOpen

        if (shouldLoad && !productsLoaded && !productsLoading) {
            const fetchProducts = async () => {
                setProductsLoading(true)
                try {
                    const productsData = await getProductsByBusiness(businessId)
                    setProducts(productsData)
                    setProductsLoaded(true)
                } catch (error) {
                    console.error("Error fetching products", error)
                } finally {
                    setProductsLoading(false)
                }
            }
            fetchProducts()
        }
    }, [businessId, activeTab, profileSubTab, manualOrderSidebarOpen, productsLoaded, productsLoading])

    // Fetch active deliveries
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

    // Real-time orders listener
    // Sound notification ref
    const isFirstOrdersLoad = React.useRef(true)

    const playNotificationSound = () => {
        try {
            const audio = new Audio('/notification-sound.mp3')
            audio.play().catch(e => console.log("Autoplay blocked or error:", e))
        } catch (e) {
            console.error("Error playing sound:", e)
        }
    }

    useEffect(() => {
        if (!businessId) return

        setLoading(true)
        isFirstOrdersLoad.current = true // Reset on business change

        // Calculate start and end of today
        const now = new Date()
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

        const q = query(
            collection(db, 'orders'),
            where('businessId', '==', businessId),
            orderBy('createdAt', 'desc')
        )

        const unsubscribe = onSnapshot(q, (snapshot) => {
            // Manejo de sonido para nuevos pedidos
            if (!isFirstOrdersLoad.current) {
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        // Verificar si el pedido es de hoy antes de sonar
                        const orderData = change.doc.data() as Order
                        const orderDate = orderData.timing?.type === 'scheduled' && orderData.timing.scheduledDate
                            ? toSafeDate(orderData.timing.scheduledDate)
                            : toSafeDate(orderData.createdAt)

                        if (orderDate >= startOfDay && orderDate < endOfDay) {
                            playNotificationSound()
                        }
                    }
                })
            }
            isFirstOrdersLoad.current = false

            const allOrders = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Order[]

            // Filter for today's orders
            const todayOrders = allOrders.filter(order => {
                const orderDate = order.timing?.type === 'scheduled' && order.timing.scheduledDate
                    ? toSafeDate(order.timing.scheduledDate)
                    : toSafeDate(order.createdAt)
                return orderDate >= startOfDay && orderDate < endOfDay
            })

            // Sort by time (nearest first)
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
            setLoading(false)
        }, (error) => {
            console.error("Error listening to orders:", error)
            setLoading(false)
        })

        return () => unsubscribe()
    }, [businessId])

    // Load History
    const loadHistory = async () => {
        if (!businessId || historyLoading || historyLoaded) return
        setHistoryLoading(true)
        try {
            // Obtenemos todos los pedidos para el historial completo
            const data = await getOrdersByBusinessComplete(businessId)
            setHistoricalOrders(data)
            setHistoryLoaded(true)
        } catch (error) {
            console.error("Error loading history", error)
        } finally {
            setHistoryLoading(false)
        }
    }

    useEffect(() => {
        if (ordersSubTab === 'history' || (!loading && orders.length === 0)) {
            loadHistory()
        }
    }, [ordersSubTab, businessId, loading, orders.length])

    // Load all user businesses for dropdown
    useEffect(() => {
        if (!user || !isAuthenticated) return;
        const loadBusinesses = async () => {
            try {
                const businessAccess = await getUserBusinessAccess(user.email || '', user.uid);
                if (businessAccess.hasAccess) {
                    const all = [...businessAccess.ownedBusinesses, ...businessAccess.adminBusinesses];
                    const unique = all.filter((b: Business, i: number, self: Business[]) =>
                        i === self.findIndex((x: Business) => x.id === b.id) && !b.isHidden
                    );
                    setBusinesses(unique);
                }
            } catch (e) { console.error("Error loading businesses", e); }
        };
        loadBusinesses();
    }, [user, isAuthenticated]);

    // Dashboard Handlers
    const handleLogout = () => {
        logout()
        router.push('/business/login')
    }

    const handleBusinessChange = (newBusinessId: string) => {
        setBusinessId(newBusinessId);
    }

    const handleToggleStoreStatus = async () => {
        if (!business?.id) return
        setUpdatingStoreStatus(true)
        try {
            const currentStatus = business.manualStoreStatus
            let newStatus: 'open' | 'closed' | null = null
            if (currentStatus === null || currentStatus === undefined) newStatus = 'closed'
            else if (currentStatus === 'closed') newStatus = 'open'
            else newStatus = null

            await updateBusiness(business.id, { manualStoreStatus: newStatus })
            setBusiness(prev => prev ? { ...prev, manualStoreStatus: newStatus } : null)
        } catch (e) {
            console.log(e);
            alert('Error updating store status');
        } finally {
            setUpdatingStoreStatus(false)
        }
    }

    const handleUpdateDeliveryTime = async (minutes: number) => {
        if (!business?.id) return
        setUpdatingDeliveryTime(true)
        try {
            const currentTime = business.deliveryTime || 30
            const newTime = minutes === 0 ? 30 : currentTime + minutes
            await updateBusiness(business.id, { deliveryTime: newTime })
            setBusiness(prev => prev ? { ...prev, deliveryTime: newTime } : null)
        } catch (e) {
            console.log(e);
            alert('Error updating delivery time');
        } finally {
            setUpdatingDeliveryTime(false)
        }
    }

    const handleNewOrder = () => {
        // Notification bell callback
    }

    const handleStatusChange = async (orderId: string, newStatus: Order['status']) => {
        try {
            const currentOrder = orders.find(o => o.id === orderId);
            let assignmentUpdate: any = {};

            // Auto-assign if confirming a pending delivery order
            if (currentOrder && currentOrder.status === 'pending' && newStatus !== 'cancelled' && newStatus !== 'pending') {
                if (currentOrder.delivery?.type === 'delivery' && !currentOrder.delivery.assignedDelivery) {
                    const assignedId = await autoAssignDeliveryForOrder(currentOrder);
                    if (assignedId) {
                        assignmentUpdate['delivery.assignedDelivery'] = assignedId;
                    }
                }
            }

            await updateOrderStatus(orderId, newStatus)

            if (Object.keys(assignmentUpdate).length > 0) {
                const orderRef = doc(db, 'orders', orderId);
                await updateDoc(orderRef, assignmentUpdate);
            }
        } catch (error) {
            console.error("Error updating status:", error)
            alert("Error al actualizar estado")
        }
    }

    const handleDeliveryAssignment = async (orderId: string, deliveryId: string) => {
        try {
            const orderRef = doc(db, 'orders', orderId)
            await updateDoc(orderRef, {
                'delivery.assignedDelivery': deliveryId || null
            })
        } catch (error) {
            console.error("Error assigning delivery:", error)
            alert("Error al asignar repartidor")
        }
    }

    const handlePaymentClick = (order: Order) => {
        setSelectedOrderForPayment(order)
        setPaymentModalOpen(true)
    }

    const handleOrderUpdatedFromModal = (updatedOrder: Order) => {
        if (selectedOrderForPayment?.id === updatedOrder.id) {
            setSelectedOrderForPayment(updatedOrder)
        }
    }

    const handleSendWhatsAppAndAdvance = async (order: Order) => {
        try {
            await sendWhatsAppToDelivery(
                order,
                availableDeliveries,
                business,
                async (id, status) => { await handleStatusChange(id, status) },
                (updatedOrder) => { /* Local update if needed */ }
            )
        } catch (e) {
            console.error("Error sending WhatsApp", e)
            alert("Error al enviar WhatsApp")
        }
    }

    const handleDeleteOrder = async (orderId: string) => {
        if (!window.confirm('¿Estás seguro de que deseas eliminar este pedido?')) return

        try {
            await deleteOrder(orderId)
        } catch (error) {
            console.error("Error deleting order", error)
            alert("No se pudo eliminar el pedido")
        }
    }

    const handlePrint = async (order: Order) => {
        try {
            await printOrder({
                order: order as any,
                businessName: business?.name || "Negocio",
                businessLogo: business?.image
            })
        } catch (e) {
            console.error("Error printing", e)
            alert("Error al imprimir")
        }
    }

    // ... (rendering) ...

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar Overlay for Mobile */}
                {sidebarOpen && (
                    <div
                        className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}

                {/* Dashboard Sidebar */}
                <DashboardSidebar
                    sidebarOpen={sidebarOpen}
                    setSidebarOpen={setSidebarOpen}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    profileSubTab={profileSubTab}
                    setProfileSubTab={setProfileSubTab}
                    reportsSubTab={reportsSubTab}
                    setReportsSubTab={setReportsSubTab}
                    isTiendaMenuOpen={isTiendaMenuOpen}
                    setIsTiendaMenuOpen={setIsTiendaMenuOpen}
                    isReportsMenuOpen={isReportsMenuOpen}
                    setIsReportsMenuOpen={setIsReportsMenuOpen}
                    ordersCount={orders.length}
                    isIOS={isIOS}
                    needsUserAction={needsUserAction}
                    requestPermission={requestPermission}
                    user={user}
                    onLogout={handleLogout}
                    ordersSubTab={ordersSubTab}
                    setOrdersSubTab={setOrdersSubTab}
                />

                <div className={`flex-1 transition-all duration-300 ease-in-out overflow-y-auto w-full ${sidebarOpen ? 'lg:ml-72' : ''}`}>
                    {/* Header */}
                    <header className="bg-white shadow-sm border-b sticky top-0 z-10 w-full">
                        <div className="px-4 sm:px-6">
                            <div className="flex justify-between items-center py-3 sm:py-4">
                                <div className="flex items-center space-x-3">
                                    <button
                                        onClick={() => setSidebarOpen(!sidebarOpen)}
                                        className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                                    >
                                        <i className="bi bi-list text-2xl"></i>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setActiveTab('orders')
                                            setOrdersSubTab('today')
                                        }}
                                        className="text-xl sm:text-2xl font-bold text-red-600 hover:opacity-80 transition-opacity"
                                    >
                                        Fuddi
                                    </button>
                                    <span className="hidden sm:inline text-gray-600">Pedidos de Hoy</span>
                                </div>

                                <div className="flex items-center space-x-2 sm:space-x-4">
                                    {/* Control Manual de Tienda */}
                                    {business && (
                                        <div className="flex items-center gap-2">
                                            <div className="hidden sm:flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                                                <div className={`w-2 h-2 rounded-full ${isStoreOpen(business) ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                                                <span className="text-sm font-medium text-gray-700">
                                                    {isStoreOpen(business) ? 'Abierto' : 'Cerrado'}
                                                </span>
                                            </div>

                                            <button
                                                onClick={handleToggleStoreStatus}
                                                disabled={updatingStoreStatus}
                                                className="px-3 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 disabled:opacity-50"
                                            >
                                                <i className={`bi ${business.manualStoreStatus === 'open' ? 'bi-unlock-fill text-green-600' : business.manualStoreStatus === 'closed' ? 'bi-lock-fill text-red-600' : `bi-clock-fill ${isStoreOpen(business) ? 'text-green-600' : 'text-gray-400'}`}`} />
                                            </button>
                                        </div>
                                    )}

                                    {/* Control del Tiempo de Entrega */}
                                    {business && (
                                        <div className="flex items-center gap-2">
                                            <div className="relative group">
                                                <button
                                                    onClick={() => setShowTimeDropdown(!showTimeDropdown)}
                                                    className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 rounded-lg border transition-colors ${(business.deliveryTime || 30) > 30 ? 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'}`}
                                                >
                                                    <i className={`bi bi-clock-history hidden sm:inline ${(business.deliveryTime || 30) > 30 ? 'text-orange-600' : 'text-gray-600'}`}></i>
                                                    <span className="text-sm font-bold">
                                                        {business.deliveryTime || 30}<span className="sm:hidden">m</span><span className="hidden sm:inline"> min</span>
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
                                                                Restablecer a 30 min
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Queue Status */}
                                    <QueueStatusIndicator status={queueStatus} onRetry={retryFailed} className="hidden sm:flex" />

                                    {/* Bell */}
                                    {business?.id && (
                                        <NotificationsBell businessId={business.id} onNewOrder={handleNewOrder} />
                                    )}

                                    {/* Business Selector */}
                                    <div className="relative business-dropdown-container">
                                        <button
                                            onClick={() => setShowBusinessDropdown(!showBusinessDropdown)}
                                            className="flex items-center space-x-2 sm:space-x-3 bg-gray-50 hover:bg-gray-100 px-2 sm:px-3 py-2 rounded-lg transition-colors"
                                        >
                                            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                                                {business?.image ? (
                                                    <img src={business.image} alt={business.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center"><i className="bi bi-shop text-gray-400"></i></div>
                                                )}
                                            </div>
                                            <i className="bi bi-chevron-down text-gray-500 text-xs"></i>
                                        </button>

                                        {showBusinessDropdown && (
                                            <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-20">
                                                {businesses.map((biz) => (
                                                    <button
                                                        key={biz.id}
                                                        onClick={() => { handleBusinessChange(biz.id); setShowBusinessDropdown(false); }}
                                                        className={`w-full flex items-center space-x-3 px-4 py-3 text-left hover:bg-gray-50 ${business?.id === biz.id ? 'bg-red-50' : ''}`}
                                                    >
                                                        <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                                                            {biz.image ? <img src={biz.image} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><i className="bi bi-shop"></i></div>}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-medium text-gray-900 truncate">{biz.name}</p>
                                                        </div>
                                                        <div className="flex items-center gap-2 flex-shrink-0">
                                                            <a
                                                                href={`/${biz.username}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                onClick={(e) => e.stopPropagation()}
                                                                className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                                                title="Visitar perfil"
                                                            >
                                                                <i className="bi bi-box-arrow-up-right text-lg"></i>
                                                            </a>
                                                            {business?.id === biz.id && <i className="bi bi-check-circle-fill text-red-500"></i>}
                                                        </div>
                                                    </button>
                                                ))}
                                                <hr className="my-2" />
                                                <button onClick={handleLogout} className="w-full flex items-center space-x-3 px-4 py-3 text-left hover:bg-red-50 text-red-600">
                                                    <i className="bi bi-box-arrow-right"></i>
                                                    <span>Cerrar Sesión</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </header>

                    {/* Main Content Area: Conditional Rendering */}
                    {activeTab === 'checklist' ? (
                        <div className="p-4 sm:p-6">
                            <DayPreflightChecklist
                                business={business}
                                onToggleStoreStatus={handleToggleStoreStatus}
                                updatingStoreStatus={updatingStoreStatus}
                                onUpdateDeliveryTime={handleUpdateDeliveryTime}
                                updatingDeliveryTime={updatingDeliveryTime}
                                onGoToProducts={() => { setActiveTab('profile'); setProfileSubTab('products') }}
                                historicalOrders={historicalOrders}
                            />
                        </div>
                    ) : activeTab === 'stats' ? (
                        <div className="p-4 sm:p-6">
                            <StatisticsView key={business?.id} orders={[...orders, ...historicalOrders]} />
                        </div>
                    ) : activeTab === 'wallet' ? (
                        <div className="p-4 sm:p-6">
                            {business && <WalletView business={business} orders={orders} historicalOrders={historicalOrders} />}
                        </div>
                    ) : activeTab === 'inventory' ? (
                        <div className="p-4 sm:p-6">
                            <IngredientStockManagement business={business} />
                        </div>
                    ) : activeTab === 'reports' ? (
                        <div className="p-4 sm:p-6">
                            <CostReports key={reportsSubTab} business={business} initialReportType={reportsSubTab as any} />
                        </div>
                    ) : activeTab === 'profile' && profileSubTab === 'general' ? (
                        <div className="p-4 sm:p-6">
                            {business && (
                                <BusinessProfileEditor
                                    business={business}
                                    onSave={handleSaveProfileGeneral}
                                    onCancel={() => setActiveTab('orders')}
                                    saving={savingProfile}
                                />
                            )}
                        </div>
                    ) : activeTab === 'profile' && profileSubTab !== 'products' && profileSubTab !== 'general' ? (
                        <div className="p-4 sm:p-6">
                            {business && (
                                <BusinessProfileDashboard
                                    key={profileSubTab}
                                    business={business}
                                    editedBusiness={editedBusiness}
                                    isEditingProfile={isEditingProfile}
                                    uploadingCover={uploadingCover}
                                    uploadingProfile={uploadingProfile}
                                    uploadingLocation={uploadingLocation}
                                    products={products}
                                    categories={categories}
                                    onCoverImageUpload={handleCoverImageUpload}
                                    onProfileImageUpload={handleProfileImageUpload}
                                    onLocationImageUpload={handleLocationImageUpload}
                                    onEditProfile={handleEditProfile}
                                    onCancelEdit={handleCancelEdit}
                                    onSaveProfile={handleSaveProfile}
                                    onBusinessFieldChange={handleBusinessFieldChange}
                                    onScheduleFieldChange={handleScheduleFieldChange}
                                    onToggleDayOpen={handleToggleDayOpen}
                                    onProductsChange={handleProductsChange}
                                    onCategoriesChange={handleCategoriesChange}
                                    initialTab={profileSubTab}
                                    onDirectUpdate={handleDirectUpdate}
                                    onRemoveAdmin={handleRemoveAdmin}
                                    onTransferOwnership={handleTransferOwnership}
                                    userRole={userRole}
                                />
                            )}
                        </div>
                    ) : activeTab === 'profile' && profileSubTab === 'products' ? (
                        <div className="p-4 sm:p-6">
                            {productsLoading ? (
                                <div className="flex justify-center items-center py-12">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
                                </div>
                            ) : (
                                <ProductList
                                    business={business}
                                    products={products}
                                    categories={categories}
                                    onProductsChange={handleProductsChange}
                                    onCategoriesChange={handleCategoriesChange}
                                    onDirectUpdate={handleDirectUpdate}
                                />
                            )}
                        </div>
                    ) : (
                        <>
                            {/* Sub-tabs for Orders removed - managed by sidebar */}

                            {ordersSubTab === 'history' ? (
                                <div className="p-4 sm:p-6">
                                    <OrderHistory
                                        orders={historicalOrders}
                                        onOrderEdit={(o) => {
                                            setSelectedOrderForEdit(o)
                                            setManualSidebarMode('edit')
                                            setManualOrderSidebarOpen(true)
                                        }}
                                        onOrderDelete={(id) => handleDeleteOrder(id)}
                                        getStatusColor={getStatusColor}
                                        getStatusText={getStatusText}
                                        getOrderDateTime={(o) => {
                                            if (o.timing?.type === 'scheduled' && o.timing.scheduledDate) {
                                                return toSafeDate(o.timing.scheduledDate)
                                            }
                                            return toSafeDate(o.createdAt)
                                        }}
                                    />
                                    {historyLoading && (
                                        <div className="flex justify-center py-8">
                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    {/* Totals Summary */}
                                    <div className="bg-white border-b border-gray-100 px-6 py-4">
                                        <div className="flex justify-end items-center gap-8">
                                            <div className="text-right">
                                                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Visitas Hoy</p>
                                                <p className="text-2xl font-bold text-gray-900">{visitsCount}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total Ventas</p>
                                                <p className="text-2xl font-bold text-green-600">
                                                    ${orders.reduce((acc, order) => {
                                                        if (order.status === 'cancelled') return acc

                                                        // 1. Try to calculate from items (most accurate for "product only" value)
                                                        if (order.items && order.items.length > 0) {
                                                            const itemsTotal = order.items.reduce((sum, item) => {
                                                                // Check for item.subtotal first, then calculate manually
                                                                if (typeof item.subtotal === 'number') return sum + item.subtotal

                                                                // Manual calculation backup
                                                                const price = item.product?.price || 0
                                                                const quantity = item.quantity || 1
                                                                return sum + (price * quantity)
                                                            }, 0)

                                                            if (itemsTotal > 0) return acc + itemsTotal
                                                        }

                                                        // 2. Fallback to order.subtotal if available
                                                        if (typeof order.subtotal === 'number') return acc + order.subtotal

                                                        // 3. Last resort: use total (might include delivery, but better than 0)
                                                        return acc + (order.total || 0)
                                                    }, 0).toFixed(2)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {orders.length === 0 ? (
                                        <DayPreflightChecklist
                                            business={business}
                                            onToggleStoreStatus={handleToggleStoreStatus}
                                            updatingStoreStatus={updatingStoreStatus}
                                            onUpdateDeliveryTime={handleUpdateDeliveryTime}
                                            updatingDeliveryTime={updatingDeliveryTime}
                                            onGoToProducts={() => { setActiveTab('profile'); setProfileSubTab('products') }}
                                            historicalOrders={historicalOrders}
                                        />
                                    ) : (
                                        <div className="p-4 space-y-6">
                                            {['pending', 'confirmed', 'preparing', 'ready', 'on_way', 'delivered', 'cancelled'].map(status => {
                                                const statusOrders = orders.filter(o => o.status === status);
                                                if (statusOrders.length === 0) return null;

                                                return (
                                                    <CollapsibleSection
                                                        key={status}
                                                        title={getStatusText(status)}
                                                        count={statusOrders.length}
                                                        status={status}
                                                        defaultExpanded={!['delivered', 'cancelled'].includes(status)}
                                                    >
                                                        {statusOrders.map(order => (
                                                            <OrderCard
                                                                key={order.id}
                                                                order={order}
                                                                availableDeliveries={availableDeliveries}
                                                                onStatusChange={handleStatusChange}
                                                                onDeliveryAssign={handleDeliveryAssignment}
                                                                onPaymentEdit={() => handlePaymentClick(order)}
                                                                onWhatsAppDelivery={() => handleSendWhatsAppAndAdvance(order)}
                                                                onPrint={() => handlePrint(order)}
                                                                onDeliveryStatusClick={(order) => {
                                                                    setSelectedOrderForStatusModal(order)
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
                                                                businessPhone={business?.phone}
                                                            />
                                                        ))}
                                                    </CollapsibleSection>
                                                )
                                            })}
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Floating Action Button for Manual Order */}
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

                            {/* Live Checkouts Panel - Moved to bottom */}
                            {businessId && <div className="p-4"><LiveCheckoutsPanel businessId={businessId} /></div>}

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
                                onWhatsApp={() => {
                                    if (selectedOrderForStatusModal) {
                                        handleSendWhatsAppAndAdvance(selectedOrderForStatusModal)
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
                                onOrderCreated={() => {
                                    setManualOrderSidebarOpen(false)
                                }}
                                mode={manualSidebarMode}
                                editOrder={selectedOrderForEdit}
                                onOrderUpdated={() => {
                                    setManualOrderSidebarOpen(false)
                                    setSelectedOrderForEdit(null)
                                    setManualSidebarMode('create')
                                }}
                            />

                            <CustomerContactModal
                                isOpen={customerContactModalOpen}
                                onClose={() => setCustomerContactModalOpen(false)}
                                order={selectedOrderForCustomerContact}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
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

function DeliveryStatusModal({
    isOpen,
    onClose,
    order,
    deliveryAgent,
    onWhatsApp
}: {
    isOpen: boolean,
    onClose: () => void,
    order: Order | null,
    deliveryAgent?: Delivery,
    onWhatsApp: () => void
}) {
    if (!isOpen || !order) return null

    const status = order.delivery?.acceptanceStatus

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="p-6">
                    <div className="flex justify-between items-start mb-6">
                        <h3 className="text-xl font-bold text-gray-900">Estado del Delivery</h3>
                        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg text-gray-400">
                            <i className="bi bi-x-lg"></i>
                        </button>
                    </div>

                    <div className="space-y-6">
                        {/* Agent Info */}
                        <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                                <i className="bi bi-person-fill text-2xl"></i>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 font-medium">Repartidor Asignado</p>
                                <p className="text-lg font-bold text-gray-900">{deliveryAgent?.nombres || 'No identificado'}</p>
                            </div>
                        </div>

                        {/* Confirmation Status */}
                        <div className="flex items-start gap-3">
                            <div className={`mt-1 w-2 h-2 rounded-full ${status === 'accepted' ? 'bg-green-500' :
                                status === 'rejected' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'
                                }`} />
                            <div>
                                <p className="font-bold text-gray-900">
                                    {status === 'accepted' ? 'Confirmado' :
                                        status === 'rejected' ? 'Rechazado' : 'Esperando confirmación'}
                                </p>
                                <p className="text-sm text-gray-500">
                                    {status === 'accepted' ? 'El repartidor ya aceptó el pedido y está en camino.' :
                                        status === 'rejected' ? 'El repartidor ha rechazado el pedido.' : 'El repartidor aún no ha respondido a la notificación.'}
                                </p>
                            </div>
                        </div>

                        {/* WhatsApp Action */}
                        <button
                            onClick={onWhatsApp}
                            className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-200"
                        >
                            <i className="bi bi-whatsapp text-xl"></i>
                            Enviar mensaje al Delivery
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

const getActionIcon = (status: string) => {
    switch (status) {
        case 'preparing': return 'bi-fire text-orange-500'
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

const getActionEmoji = (status: string) => {
    switch (status) {
        case 'preparing': return '🔥'
        case 'ready': return '✔️'
        case 'on_way': return '🛵'
        case 'delivered': return '🎉'
        default: return '➡️'
    }
}

function CollapsibleSection({
    title,
    count,
    status,
    children,
    defaultExpanded = true
}: {
    title: string,
    count: number,
    status: string,
    children: React.ReactNode,
    defaultExpanded?: boolean
}) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded)

    const getDotColor = (s: string) => {
        switch (s) {
            case 'pending': return 'bg-yellow-500 shadow-yellow-200'
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-3 flex justify-between items-center bg-gray-50/50 hover:bg-gray-100 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full shadow-sm ${getDotColor(status)}`}></span>
                    <h3 className="font-bold text-gray-800 text-lg">{title}</h3>
                    <span className="bg-white border border-gray-200 text-gray-600 text-xs font-bold px-2.5 py-0.5 rounded-full">{count}</span>
                </div>
                <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 transition-transform duration-200`}></i>
            </button>

            {isExpanded && (
                <div className="p-4 space-y-3 bg-gray-50/30 border-t border-gray-100 animate-in slide-in-from-top-2 duration-200">
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
    businessPhone
}: {
    order: Order,
    availableDeliveries: Delivery[],
    onStatusChange: (id: string, status: Order['status']) => void,
    onDeliveryAssign: (id: string, deliveryId: string) => void,
    onPaymentEdit: () => void,
    onWhatsAppDelivery: () => void,
    onPrint: () => void,
    onDeliveryStatusClick: (order: Order) => void,
    onEdit: () => void,
    onDelete: () => void,
    onCustomerClick: () => void,
    businessPhone?: string
}) {
    const nextStatus = getNextStatus(order.status)
    const isDelivery = order.delivery?.type === 'delivery'
    const [isExpanded, setIsExpanded] = useState(false)

    // Urgency check
    const isUrgent = () => {
        // Only for active orders that are not ready or delivered
        if (['ready', 'delivered', 'completed', 'cancelled'].includes(order.status)) return false;

        const now = new Date();
        let targetDate = new Date();

        if (order.timing?.scheduledTime) {
            const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number);
            targetDate.setHours(hours, minutes, 0, 0);
        } else {
            // For immediate orders, maybe check if created more than 30 mins ago?
            // User specifically asked for "less than 5 mins for delivery".
            // If no scheduled time, we can't really know unless we assume a standard time.
            // For now, let's stick to scheduled times or maybe immediate orders created > 40 mins ago?
            // Let's stick to strict interpretation: if scheduled and < 5 mins left.
            return false;
        }

        const diffInMinutes = (targetDate.getTime() - now.getTime()) / 60000;
        return diffInMinutes <= 5;
    }

    const urgent = isUrgent();

    // Sort items: non-zero price first, then zero price
    const sortedItems = [...(order.items || [])].sort((a: any, b: any) => {
        const priceA = (a.price || a.product?.price || 0) * a.quantity;
        const priceB = (b.price || b.product?.price || 0) * b.quantity;

        if (priceA === 0 && priceB !== 0) return 1;
        if (priceA !== 0 && priceB === 0) return -1;
        return 0; // Keep original order if both are zero or both are non-zero
    });

    return (
        <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden transition-all ${urgent ? 'animate-pulse border-red-300 ring-2 ring-red-100' : ''}`}>
            {/* Card Header: Time & Status */}
            <div
                className="px-4 py-3 border-b border-gray-50 flex justify-between items-start bg-gray-50/50 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                        {/* Chevron for expand/collapse */}
                        <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 text-xs mr-2 transform transition-transform duration-200`}></i>

                        <span
                            className="text-sm font-bold text-gray-900 flex items-center gap-2 hover:text-red-600 transition-colors"
                            onClick={(e) => {
                                e.stopPropagation()
                                onCustomerClick()
                            }}
                        >
                            <i className={`bi ${isDelivery ? 'bi-scooter' : 'bi-shop'} text-gray-400`}></i>
                            {order.customer?.name || "Cliente"}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1 ml-5">
                        <i className={`bi ${order.timing?.type === 'scheduled' ? 'bi-clock' : 'bi-lightning-fill'} ${order.timing?.type === 'scheduled' ? 'text-blue-600' : 'text-yellow-500'}`}></i>
                        <span className="font-mono font-medium text-gray-600">
                            {getOrderDisplayTime(order)}
                        </span>
                    </div>

                    {/* Items List (Small) */}
                    <div className="flex flex-col gap-0.5 mt-1 ml-5">
                        {sortedItems.map((item: any, idx) => {
                            const price = (item.price || item.product?.price || 0) * item.quantity;
                            return (
                                <div key={idx} className={`text-[10px] leading-tight truncate ${price === 0 ? 'text-gray-400 italic' : 'text-gray-600'}`}>
                                    {item.quantity}x {item.variant || item.product?.name || item.name}
                                </div>
                            )
                        })}
                    </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        {/* Advance Status */}
                        {nextStatus && (
                            <button
                                onClick={() => onStatusChange(order.id, nextStatus)}
                                className={`flex items-center gap-1 rounded-lg transition-colors shadow-sm ${nextStatus === 'confirmed'
                                    ? 'px-3 py-1.5 text-xs font-bold bg-green-600 text-white hover:bg-green-700'
                                    : 'p-1.5 text-lg hover:bg-white hover:shadow-md'
                                    }`}
                                title={getActionText(nextStatus)}
                            >
                                {nextStatus === 'confirmed' ? (
                                    <>
                                        <span>{getActionText(nextStatus)}</span>
                                        <i className="bi bi-check2-circle"></i>
                                    </>
                                ) : (
                                    <i className={`bi ${getActionIcon(nextStatus)}`}></i>
                                )}
                            </button>
                        )}

                        {/* Delivery Acceptance Status */}
                        {isDelivery && order.delivery?.assignedDelivery && (
                            <div
                                className="p-1.5 flex items-center cursor-pointer hover:bg-white hover:shadow-sm rounded-lg transition-all"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onDeliveryStatusClick(order)
                                }}
                                title={
                                    order.delivery?.acceptanceStatus === 'accepted' ? 'Delivery Confirmado' :
                                        order.delivery?.acceptanceStatus === 'rejected' ? 'Delivery Rechazado' :
                                            'Esperando confirmación del delivery'
                                }
                            >
                                <span className={`material-symbols-rounded text-2xl transition-all ${order.delivery?.acceptanceStatus === 'accepted'
                                    ? 'text-green-500'
                                    : order.delivery?.acceptanceStatus === 'rejected'
                                        ? 'text-red-500'
                                        : 'text-yellow-500 animate-pulse'
                                    }`}>
                                    motorcycle
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Card Body */}
            {isExpanded && (
                <div className="p-4 bg-white animate-in slide-in-from-top-2 duration-200">
                    {/* Customer Info */}
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex-1 pr-2">
                            {isDelivery && (
                                <p className="text-sm text-gray-500 line-clamp-2">
                                    📍 {order.delivery?.references || (order.delivery as any)?.reference || "Ubicación"}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Items */}
                    <div className="space-y-2 mb-4">
                        {order.items?.map((item: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-sm">
                                <span className="text-gray-700">
                                    <span className="font-medium text-gray-900">{item.quantity}x</span> {item.variant || item.product?.name || item.name}
                                </span>
                                <span className="text-gray-500">${((item.price || item.product?.price || 0) * item.quantity).toFixed(2)}</span>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-dashed border-gray-200 my-3"></div>

                    {/* Total & Payment */}
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
                                <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-credit-card' :
                                    order.payment?.method === 'mixed' ? 'bi-cash-coin' : 'bi-cash'
                                    }`}></i>
                                <span>${(order.total || 0).toFixed(2)}</span>
                                <i className="bi bi-pencil-square text-xs opacity-50 ml-1"></i>
                            </button>
                        </div>

                        {/* Print Button */}
                        <button
                            onClick={onPrint}
                            className="p-2 text-gray-400 hover:text-gray-600"
                        >
                            <i className="bi bi-printer"></i>
                        </button>
                    </div>

                    {/* Delivery Assignment */}
                    {isDelivery && (
                        <div className="mb-4">
                            <div className="flex items-center border border-gray-300 rounded-lg bg-white overflow-hidden">
                                <div className="bg-gray-100 px-3 py-2 border-r border-gray-300 text-gray-600">
                                    <i className="bi bi-truck text-lg"></i>
                                </div>
                                <select
                                    value={order.delivery?.assignedDelivery || ""}
                                    onChange={(e) => onDeliveryAssign(order.id, e.target.value)}
                                    className="w-full text-sm p-2 bg-transparent outline-none cursor-pointer hover:bg-gray-50 transition-colors"
                                >
                                    <option value="">Asignar Repartidor...</option>
                                    {availableDeliveries.map(d => (
                                        <option key={d.id} value={d.id}>{d.nombres}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Actions: Edit & Delete */}
                    <div className="flex gap-2 pt-4 border-t border-gray-100">
                        <button
                            onClick={onEdit}
                            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                            <i className="bi bi-pencil"></i>
                            Editar Pedido
                        </button>
                        <button
                            onClick={onDelete}
                            className="flex items-center justify-center p-2 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                        >
                            <i className="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
