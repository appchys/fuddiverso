'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
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
    getOrdersByBusinessPaginated,
    getOrdersByBusinessComplete,
    uploadImage,
    addBusinessAdministrator,
    removeBusinessAdministrator,
    getIngredientStockSummary
} from '@/lib/database'
import {
    sendWhatsAppToDelivery,
    sendWhatsAppToCustomer,
    getNextStatus
} from '@/components/WhatsAppUtils'
import { isStoreOpen, getNextOpeningMessage, calculateManualStatusExpiry } from '@/lib/store-utils'
import QueueStatusIndicator from '@/components/QueueStatusIndicator'
import NotificationsBell from '@/components/NotificationsBell'
import { useOfflineQueue } from '@/hooks/useOfflineQueue'
import { auth } from '@/lib/firebase'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import DashboardSidebar from '@/components/DashboardSidebar'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'

const ProductList = dynamic(() => import('@/components/ProductList'), { ssr: false })
const DayPreflightChecklist = dynamic(() => import('@/components/DayPreflightChecklist'), { ssr: false })

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
const QRCodesContent = dynamic(() => import('@/app/business/qr-codes/qr-codes-content'), { ssr: false })
const ExpensesView = dynamic(() => import('@/components/ExpensesView'), { ssr: false })
const FinanceView = dynamic(() => import('@/components/FinanceView'), { ssr: false })

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



import type { CheckoutSession } from '@/components/LiveCheckoutsPanel'

const PaymentManagementModals = dynamic(() => import('@/components/PaymentManagementModals'), { ssr: false })
const ManualOrderSidebar = dynamic(() => import('@/components/ManualOrderSidebar'), { ssr: false })
const LiveCheckoutsPanel = dynamic(() => import('@/components/LiveCheckoutsPanel').then(m => m.LiveCheckoutsPanel), { ssr: false })

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
            return order.timing.scheduledTime; // Already formatted as HH:MM
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

const MUNCHYS_BUSINESS_ID = '0FeNtdYThoTRMPJ6qaS7'

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
    const [checkoutCount, setCheckoutCount] = useState(0)
    const [printMode, setPrintMode] = useState<'standard' | 'bluetooth'>('standard')
    const { queueStatus, retryFailed } = useOfflineQueue()

    // Ref for business dropdown container
    const businessDropdownRef = useRef<HTMLDivElement>(null)
    // Ref for time dropdown container
    const timeDropdownRef = useRef<HTMLDivElement>(null)

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
    const [activeTab, setActiveTab] = useState<'orders' | 'profile' | 'admins' | 'reports' | 'inventory' | 'qrcodes' | 'stats' | 'wallet' | 'checklist' | 'expenses' | 'finance'>('orders')
    const [profileSubTab, setProfileSubTab] = useState<'general' | 'products' | 'fidelizacion' | 'notifications' | 'admins'>('general')
    const [reportsSubTab, setReportsSubTab] = useState<'general' | 'deliveries' | 'costs'>('general')
    const [isTiendaMenuOpen, setIsTiendaMenuOpen] = useState(false)
    const [isReportsMenuOpen, setIsReportsMenuOpen] = useState(false)
    const [summaryExpanded, setSummaryExpanded] = useState(false)

    // Load today's expenses
    const [todayExpenses, setTodayExpenses] = useState<any[]>([])

    useEffect(() => {
        if (!businessId) return

        const now = new Date()
        const todayStr = now.toISOString().split('T')[0]

        const q = query(
            collection(db, 'expenses'),
            where('businessId', '==', businessId),
            where('date', '==', todayStr)
        )

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }))
            setTodayExpenses(data)
        }, (error) => {
            console.error("Error listening to expenses:", error)
        })

        return () => unsubscribe()
    }, [businessId])


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
        
        const savedPrintMode = localStorage.getItem('fuddi_print_mode')
        if (savedPrintMode === 'bluetooth' || savedPrintMode === 'standard') {
            setPrintMode(savedPrintMode)
        }
    }, [])

    const togglePrintMode = () => {
        const newMode = printMode === 'standard' ? 'bluetooth' : 'standard'
        setPrintMode(newMode)
        localStorage.setItem('fuddi_print_mode', newMode)
    }

    // activeTab removed (was 'orders') - now we use orders state directly
    const [orders, setOrders] = useState<Order[]>([])
    const [loading, setLoading] = useState(true)
    const [availableDeliveries, setAvailableDeliveries] = useState<Delivery[]>([])
    const [business, setBusiness] = useState<Business | null>(null)
    const [products, setProducts] = useState<Product[]>([])

    const totalTodayExpenses = useMemo(() => {
        return todayExpenses.reduce((sum, e) => sum + (e.amount || 0), 0)
    }, [todayExpenses])

    const totalTodaySales = useMemo(() => {
        return orders.reduce((acc, order) => {
            if (order.status === 'cancelled') return acc
            
            // Si tiene items, calcular lo que recibe la tienda
            if (order.items && order.items.length > 0) {
                const calculatedStoreTotal = order.items.reduce((sum, item) => {
                    const price = item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0))
                    return sum + (price * (item.quantity || 1))
                }, 0)
                return acc + calculatedStoreTotal
            }
            
            // Fallback para órdenes sin items detallados (ej: antiguas o manuales simples)
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

    // Sub-tab state for Orders
    const [ordersSubTab, setOrdersSubTab] = useState<'today' | 'history'>('today')
    const [historicalOrders, setHistoricalOrders] = useState<Order[]>([])
    const [allUpcomingOrders, setAllUpcomingOrders] = useState<Order[]>([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [historyLoaded, setHistoryLoaded] = useState(false)
    const [lastHistoryDoc, setLastHistoryDoc] = useState<any>(null)
    const [hasMoreHistory, setHasMoreHistory] = useState(true)

    const mergedHistoryOrders = useMemo(() => {
        const seen = new Set<string>()
        const merged: Order[] = []
        
        // Preponderancia a pedidos próximos
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

    // ... existing modal states ...
    const [paymentModalOpen, setPaymentModalOpen] = useState(false)
    const [selectedOrderForPayment, setSelectedOrderForPayment] = useState<Order | null>(null)

    const [deliveryStatusModalOpen, setDeliveryStatusModalOpen] = useState(false)
    const [selectedOrderForStatusModal, setSelectedOrderForStatusModal] = useState<Order | null>(null)

    const [manualOrderSidebarOpen, setManualOrderSidebarOpen] = useState(false)
    const [manualSidebarMode, setManualSidebarMode] = useState<'create' | 'edit'>('create')
    const [selectedOrderForEdit, setSelectedOrderForEdit] = useState<Order | null>(null)

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

    const [customerContactModalOpen, setCustomerContactModalOpen] = useState(false)
    const [selectedOrderForCustomerContact, setSelectedOrderForCustomerContact] = useState<Order | null>(null)

    // Cache de notas de clientes
    const [clientsWithNotes, setClientsWithNotes] = useState<Record<string, string>>({})

    // Cargar notas de clientes de las órdenes activas y futuras (se excluye el historial para evitar lecturas masivas innecesarias)
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

            // Filtrar los teléfonos que aún no hemos consultado
            const newPhones = phones.filter(phone => clientsWithNotes[phone] === undefined)

            if (newPhones.length === 0) return

            // Marcar todos como consultados provisionalmente de golpe para evitar peticiones duplicadas
            const provisionalNotes: Record<string, string> = {}
            for (const phone of newPhones) {
                provisionalNotes[phone] = ''
            }
            setClientsWithNotes(prev => ({ ...prev, ...provisionalNotes }))

            // Buscar notas en paralelo
            try {
                const results = await Promise.all(
                    newPhones.map(async (phone) => {
                        try {
                            const client = await searchClientByPhone(phone)
                            return { phone, notas: client?.notas || '' }
                        } catch (error) {
                            console.error(`Error fetching client notes for phone ${phone}:`, error)
                            return { phone, notas: '' }
                        }
                    })
                )

                // Construir mapa final y actualizar de una sola vez
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

    // Limpiar caché cuando se cierra el sidebar de pedidos manuales por si se editaron notas
    useEffect(() => {
        if (!manualOrderSidebarOpen) {
            setClientsWithNotes({})
        }
    }, [manualOrderSidebarOpen])

    // ProductList specific state
    const [categories, setCategories] = useState<string[]>([])
    const [productsLoaded, setProductsLoaded] = useState(false)
    const [productsLoading, setProductsLoading] = useState(false)
    
    // Favorite ingredients stock state
    const [favStockSummary, setFavStockSummary] = useState<any[]>([])
    const [favIngredients, setFavIngredients] = useState<string[]>([])
    const [currentFavIndex, setCurrentFavIndex] = useState(0)

    useEffect(() => {
        if (!businessId) return
        const saved = localStorage.getItem(`fuddi_fav_ingredients_${businessId}`)
        if (saved) setFavIngredients(JSON.parse(saved))
        else setFavIngredients([])
        setCurrentFavIndex(0)
    }, [businessId, activeTab])

    useEffect(() => {
        if (!businessId || favIngredients.length === 0) {
            setFavStockSummary([])
            return
        }

        const fetchStock = async () => {
            try {
                const summary = await getIngredientStockSummary(businessId)
                const onlyFavs = summary.filter(s => favIngredients.includes(s.ingredientId))
                
                setFavStockSummary(prev => {
                    // Verificamos si los ingredientes son los mismos para mantener el orden
                    const prevIds = prev.map(p => p.ingredientId).sort().join(',')
                    const currentIds = onlyFavs.map(o => o.ingredientId).sort().join(',')
                    
                    if (prev.length > 0 && prevIds === currentIds) {
                        return prev.map(p => {
                            const updated = onlyFavs.find(o => o.ingredientId === p.ingredientId)
                            return updated ? updated : p
                        })
                    }
                    // Si es la primera vez o cambiaron los favoritos, barajamos
                    return [...onlyFavs].sort(() => Math.random() - 0.5)
                })
            } catch (e) {
                console.error("Error fetching fav stock", e)
            }
        }
        fetchStock()
        
        const interval = setInterval(fetchStock, 60000)
        return () => clearInterval(interval)
    }, [businessId, favIngredients])

    const nextFav = (e: React.MouseEvent) => {
        e.stopPropagation()
        setCurrentFavIndex(prev => (prev + 1) % favStockSummary.length)
    }

    const prevFav = (e: React.MouseEvent) => {
        e.stopPropagation()
        setCurrentFavIndex(prev => (prev - 1 + favStockSummary.length) % favStockSummary.length)
    }

    useEffect(() => {
        if (business?.categories) {
            setCategories(business.categories)
        }
    }, [business])

    const showCol1 = useMemo(() => orders.some(o => ['borrador', 'pending'].includes(o.status)) || checkoutCount > 0, [orders, checkoutCount]);
    const showCol2 = useMemo(() => orders.some(o => o.status === 'confirmed'), [orders]);
    const showCol3 = useMemo(() => orders.some(o => ['preparing', 'ready', 'on_way', 'delivered', 'cancelled'].includes(o.status)), [orders]);
    const configuredDeliveryTime = getConfiguredDeliveryTime(business)
    const currentDeliveryTime = business?.deliveryTime ?? configuredDeliveryTime
    const isDeliveryTimeExtended = currentDeliveryTime > configuredDeliveryTime

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
    const [showAddAdminModal, setShowAddAdminModal] = useState(false)
    const [newAdminData, setNewAdminData] = useState({
        email: '',
        password: '',
        role: 'admin' as 'admin' | 'manager',
        permissions: {
            manageProducts: true,
            manageOrders: true,
            manageAdmins: false,
            viewReports: true,
            editBusiness: false
        }
    })
    const [addingAdmin, setAddingAdmin] = useState(false)
    const [passwordAdminEmail, setPasswordAdminEmail] = useState<string | null>(null)
    const [adminPassword, setAdminPassword] = useState('')
    const [savingAdminPassword, setSavingAdminPassword] = useState(false)

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

    const canManageAdmins = userRole === 'owner' || !!business?.administrators?.some(admin =>
        admin.email === user?.email && admin.permissions?.manageAdmins
    )

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
        setEditedBusiness(prev => prev ? { ...prev, [field]: value } : prev)
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

    const handleAddAdmin = async () => {
        if (!business || !newAdminData.email.trim()) return

        setAddingAdmin(true)
        try {
            const currentUser = auth.currentUser
            if (!currentUser) throw new Error('Usuario no autenticado')

            if (newAdminData.password.trim()) {
                const token = await currentUser.getIdToken()
                const response = await fetch('/api/business/admin-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        businessId: business.id,
                        email: newAdminData.email.trim(),
                        password: newAdminData.password,
                        role: newAdminData.role,
                        permissions: newAdminData.permissions
                    })
                })
                const result = await response.json()

                if (!response.ok) {
                    throw new Error(result.error || 'Error al crear el acceso del administrador')
                }
            } else {
                await addBusinessAdministrator(
                    business.id,
                    newAdminData.email.trim(),
                    newAdminData.role,
                    newAdminData.permissions,
                    currentUser.uid
                )
            }

            const updatedBusiness = await getBusiness(business.id)
            if (updatedBusiness) {
                setBusiness(updatedBusiness)
                setBusinesses(prev => prev.map(b => b.id === business.id ? updatedBusiness : b))
            }

            setNewAdminData({
                email: '',
                password: '',
                role: 'admin',
                permissions: {
                    manageProducts: true,
                    manageOrders: true,
                    manageAdmins: false,
                    viewReports: true,
                    editBusiness: false
                }
            })
            setShowAddAdminModal(false)
            alert('Administrador agregado exitosamente')
        } catch (error: any) {
            alert(error.message || 'Error al agregar administrador')
        } finally {
            setAddingAdmin(false)
        }
    }

    const handleSaveAdminPassword = async () => {
        if (!business || !passwordAdminEmail || !adminPassword.trim()) return

        setSavingAdminPassword(true)
        try {
            const currentUser = auth.currentUser
            if (!currentUser) throw new Error('Usuario no autenticado')

            const token = await currentUser.getIdToken()
            const response = await fetch('/api/business/admin-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    businessId: business.id,
                    email: passwordAdminEmail,
                    password: adminPassword
                })
            })
            const result = await response.json()

            if (!response.ok) {
                throw new Error(result.error || 'Error al guardar la contrasena')
            }

            const updatedBusiness = await getBusiness(business.id)
            if (updatedBusiness) {
                setBusiness(updatedBusiness)
                setBusinesses(prev => prev.map(b => b.id === business.id ? updatedBusiness : b))
            }

            setPasswordAdminEmail(null)
            setAdminPassword('')
            alert('Contrasena actualizada exitosamente')
        } catch (error: any) {
            alert(error.message || 'Error al guardar la contrasena')
        } finally {
            setSavingAdminPassword(false)
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

    // Auto-repair effect for missing manualStatusExpiry
    useEffect(() => {
        if (!business?.id || !business.manualStoreStatus) return
        if (business.manualStatusExpiry) return

        const repairExpiry = async () => {
            console.log('🔧 [Auto-repair] Manual status detected without expiry for:', business.name)
            const expiry = calculateManualStatusExpiry(business)
            if (expiry) {
                try {
                    await updateBusiness(business.id, { manualStatusExpiry: expiry })
                    console.log('✅ [Auto-repair] Expiry set to:', expiry.toLocaleString('es-EC'))
                    setBusiness(prev => prev?.id === business.id ? { ...prev, manualStatusExpiry: expiry } : prev)
                } catch (err) {
                    console.error('❌ [Auto-repair] Failed to update expiry:', err)
                }
            } else {
                console.warn('⚠️ [Auto-repair] Could not calculate expiry for:', business.name)
            }
        }
        repairExpiry()
    }, [business?.id, business?.manualStoreStatus, !!business?.manualStatusExpiry])

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

        // Map to hold and merge orders from all three queries
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

            // Scheduled orders only belong here when their scheduled date is today.
            const todayOrders = allMergedOrders.filter(shouldShowInTodayOrders)

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
            
            // Only stop loading spinner when all queries have fetched their initial snapshot
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
        const qCreatedToday = query(
            collection(db, 'orders'),
            where('businessId', '==', businessId),
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

        // Listener 2: Active orders from any time (pending, preparing, etc.)
        const qActive = query(
            collection(db, 'orders'),
            where('businessId', '==', businessId),
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

        // Listener 3: Scheduled orders for today
        const qScheduledToday = query(
            collection(db, 'orders'),
            where('businessId', '==', businessId),
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

        const todayString = toLocalDateInputValue(startOfDay)
        const tomorrowString = toLocalDateInputValue(endOfDay)
        const qScheduledTodayString = query(
            collection(db, 'orders'),
            where('businessId', '==', businessId),
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

        const loadLegacyScheduledToday = async () => {
            try {
                const allOrders = await getOrdersByBusinessComplete(businessId)
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

        // Set isFirstOrdersLoad.current = false after all initial queries have reported at least once
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
    }, [businessId])

    // Fetch all upcoming orders (future scheduled)
    useEffect(() => {
        if (!businessId) return

        const now = new Date()
        const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

        const q = query(
            collection(db, 'orders'),
            where('businessId', '==', businessId),
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
    }, [businessId])

    // Load History
    const loadHistory = async () => {
        if (!businessId || historyLoading || (historyLoaded && !hasMoreHistory)) return
        setHistoryLoading(true)
        try {
            // Obtenemos los pedidos para el historial de forma paginada
            const { orders: data, lastDoc } = await getOrdersByBusinessPaginated(businessId, 20, lastHistoryDoc)
            
            // Filtrar duplicados por si acaso
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
    }, [businessId])

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

    // Close business dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (businessDropdownRef.current && !businessDropdownRef.current.contains(event.target as Node)) {
                setShowBusinessDropdown(false)
            }
        }

        if (showBusinessDropdown) {
            document.addEventListener('mousedown', handleClickOutside)
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [showBusinessDropdown])

    // Close time dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (timeDropdownRef.current && !timeDropdownRef.current.contains(event.target as Node)) {
                setShowTimeDropdown(false)
            }
        }

        if (showTimeDropdown) {
            document.addEventListener('mousedown', handleClickOutside)
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [showTimeDropdown])

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
            // Check if current manual status is effectively active or expired
            let currentStatus = business.manualStoreStatus
            if (currentStatus) {
                const now = new Date()
                const expiry = business.manualStatusExpiry ? toSafeDate(business.manualStatusExpiry) : null
                if (expiry && now >= expiry) {
                    console.log('🔄 Toggle: Existing manual status is expired, treating as automatic')
                    currentStatus = null
                }
            }

            let newStatus: 'open' | 'closed' | null = null
            if (currentStatus === null || currentStatus === undefined) newStatus = 'closed'
            else if (currentStatus === 'closed') newStatus = 'open'
            else newStatus = null

            // Calculate expiry time for manual control (if needed)
            let expiryTime: Date | null = null
            if (newStatus !== null) {
                expiryTime = calculateManualStatusExpiry(business)
            }

            console.log('🔄 Store status toggle:', {
                businessId: business.id,
                currentStatus: currentStatus,
                newStatus: newStatus,
                expiryTime: expiryTime?.toLocaleString('es-EC')
            })

            const updateData: any = { 
                manualStoreStatus: newStatus,
                manualStatusExpiry: expiryTime 
            }

            await updateBusiness(business.id, updateData)
            
            console.log('✅ Firebase update completed, updating local state')
            setBusiness(prev => prev ? { 
                ...prev, 
                manualStoreStatus: newStatus,
                manualStatusExpiry: expiryTime || undefined
            } : null)
        } catch (e) {
            console.error('❌ Error updating store status:', e)
            alert('Error updating store status: ' + (e as Error).message)
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
            console.log(e);
            alert('Error updating delivery time');
        } finally {
            setUpdatingDeliveryTime(false)
        }
    }

    const handleNewOrder = () => {
        // Notification bell callback
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

            // Auto-assign delivery logic
            if (currentOrder && isDelivery && hasNoDeliveryAssigned) {
                // Scenario A: Confirming a pending order (Immediate orders go to preparing, Scheduled go to confirmed)
                // We only assign delivery here if it's NOT scheduled (meaning it's immediate)
                if (currentOrder.status === 'pending' && newStatus !== 'cancelled' && newStatus !== 'pending' && !isScheduled) {
                    const assignedId = await autoAssignDeliveryForOrder(currentOrder, business?.defaultDeliveryId);
                    if (assignedId) {
                        assignmentUpdate['delivery.assignedDelivery'] = assignedId;
                    }
                }
                // Scenario B: Moving a scheduled order from confirmed to preparing (purple button)
                else if (currentOrder.status === 'confirmed' && newStatus === 'preparing' && isScheduled) {
                    const assignedId = await autoAssignDeliveryForOrder(currentOrder, business?.defaultDeliveryId);
                    if (assignedId) {
                        assignmentUpdate['delivery.assignedDelivery'] = assignedId;
                    }
                }
            }

            await updateOrderStatus(orderId, newStatus, reason)

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

    const handlePaymentClick = (order: Order) => {
        setSelectedOrderForPayment(order)
        setPaymentModalOpen(true)
    }

    const handleOrderUpdatedFromModal = (updatedOrder: Order) => {
        updateOrderEverywhere(updatedOrder)
    }

    const handleSendWhatsAppToDelivery = async (order: Order) => {
        try {
            await sendWhatsAppToDelivery(
                order,
                availableDeliveries,
                business
                // Removed callbacks to prevent automatic status advancement
            )
        } catch (e) {
            console.error("Error sending WhatsApp", e)
            alert("Error al enviar WhatsApp")
        }
    }

    const handleDeleteOrder = async (orderId: string) => {
        if (business?.id !== MUNCHYS_BUSINESS_ID) {
            alert('Solo Munchys puede borrar órdenes.')
            return
        }

        if (!window.confirm('¿Estás seguro de que deseas eliminar este pedido?')) return

        try {
            await deleteOrder(orderId)
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
            if (silent) return; // No alerts in silent mode
            
            if (printMode === 'bluetooth' && e.name === 'NotFoundError') {
                // User cancelled or no device found
                return
            }
            alert("Error al imprimir: " + (e.message || "Error desconocido"))
        }
    }

    const handleOpenManualOrderFromCheckout = (checkoutSession: CheckoutSession) => {
        // Crear una orden temporal basada en los datos del checkout para prellenar el formulario
        const tempOrder: any = {
            id: `checkout-${checkoutSession.id}`, // ID temporal solo para prellenar
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
            _isFromCheckout: true // Bandera para identificar que viene de un checkout
        }

        // Usar el mismo sidebar pero en modo edit con datos precargados
        setSelectedOrderForEdit(tempOrder)
        setManualSidebarMode('edit')
        setManualOrderSidebarOpen(true)
    }

    // ... (rendering) ...

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-100 p-4 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
            </div>
        )
    }

    const canManageRestrictedOrderActions = business?.id === MUNCHYS_BUSINESS_ID
    const canChangeDelivery = true

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col">
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
                    <header className="bg-white shadow-sm border-b sticky top-0 z-30 w-full">
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

                                            {(() => {
                                                const isManualActive = business.manualStoreStatus && (!business.manualStatusExpiry || new Date() < toSafeDate(business.manualStatusExpiry))
                                                
                                                return (
                                                    <button
                                                        onClick={handleToggleStoreStatus}
                                                        disabled={updatingStoreStatus}
                                                        className="px-3 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 disabled:opacity-50"
                                                        title={isManualActive ? (business.manualStoreStatus === 'open' ? 'Abierto (Manual)' : 'Cerrado (Manual)') : 'Horario Automático'}
                                                    >
                                                        <i className={`bi ${isManualActive ? (business.manualStoreStatus === 'open' ? 'bi-unlock-fill text-green-600' : 'bi-lock-fill text-red-600') : `bi-clock-fill ${isStoreOpen(business) ? 'text-green-600' : 'text-gray-400'}`}`} />
                                                    </button>
                                                )
                                            })()}
                                        </div>
                                    )}

                                    {/* Control del Tiempo de Entrega */}
                                    {business && (
                                        <div className="flex items-center gap-2">
                                            <div className="relative group" ref={timeDropdownRef}>
                                                <button
                                                    onClick={() => setShowTimeDropdown(!showTimeDropdown)}
                                                    className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 rounded-lg border transition-colors ${isDeliveryTimeExtended ? 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'}`}
                                                >
                                                    <i className={`bi bi-clock-history hidden sm:inline ${isDeliveryTimeExtended ? 'text-orange-600' : 'text-gray-600'}`}></i>
                                                    <span className="text-sm font-bold">
                                                        {currentDeliveryTime}<span className="sm:hidden">m</span><span className="hidden sm:inline"> min</span>
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
                                        </div>
                                    )}

                                    {/* Queue Status */}
                                    <QueueStatusIndicator status={queueStatus} onRetry={retryFailed} className="hidden sm:flex" />

                                    {/* Bell */}
                                    {business?.id && (
                                        <NotificationsBell businessId={business.id} onNewOrder={handleNewOrder} />
                                    )}


                                    {/* Business Selector */}
                                    <div className="relative business-dropdown-container" ref={businessDropdownRef}>
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
                                            <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-[60]">
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
                    {activeTab === 'stats' ? (
                        <div className="p-4 sm:p-6">
                            <StatisticsView key={business?.id} orders={[...orders, ...historicalOrders]} />
                        </div>
                    ) : activeTab === 'wallet' ? (
                        <div className="p-4 sm:p-6">
                            {business && <WalletView business={business} orders={orders} historicalOrders={historicalOrders} />}
                        </div>
                    ) : activeTab === 'expenses' ? (
                        <div className="p-4 sm:p-6">
                            <ExpensesView business={business} user={user} />
                        </div>
                    ) : activeTab === 'finance' ? (
                        <div className="p-4 sm:p-6">
                            <FinanceView business={business} user={user} />
                        </div>
                    ) : activeTab === 'inventory' ? (
                        <div className="p-4 sm:p-6">
                            <IngredientStockManagement business={business} />
                        </div>
                    ) : activeTab === 'reports' ? (
                        <div className="p-4 sm:p-6">
                            <CostReports key={reportsSubTab} business={business} initialReportType={reportsSubTab as any} />
                        </div>
                    ) : activeTab === 'qrcodes' ? (
                        <div className="p-4 sm:p-6">
                            <QRCodesContent businessId={businessId} />
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
                                    onAddAdmin={canManageAdmins ? () => setShowAddAdminModal(true) : undefined}
                                    onRemoveAdmin={handleRemoveAdmin}
                                    onEditAdminPassword={canManageAdmins ? (email) => {
                                        setPasswordAdminEmail(email)
                                        setAdminPassword('')
                                    } : undefined}
                                    onTransferOwnership={handleTransferOwnership}
                                    userRole={userRole}
                                    printMode={printMode}
                                    onTogglePrintMode={togglePrintMode}
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
                                        orders={mergedHistoryOrders}
                                        onLoadMore={loadHistory}
                                        hasMore={hasMoreHistory}
                                        loadingMore={historyLoading}
                                        onOrderEdit={(o) => {
                                            setSelectedOrderForEdit(o)
                                            setManualSidebarMode('edit')
                                            setManualOrderSidebarOpen(true)
                                        }}
                                        onOrderDelete={canManageRestrictedOrderActions ? (id) => handleDeleteOrder(id) : undefined}
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
                                        onPaymentEdit={(order) => {
                                            handlePaymentClick(order)
                                        }}
                                        onWhatsAppDelivery={(order) => {
                                            // WhatsApp logic here if needed
                                        }}
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
                                        canDeleteOrders={canManageRestrictedOrderActions}
                                    />
                                    {historyLoading && (
                                        <div className="flex justify-center py-8">
                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <div className="p-4 space-y-6">
                                        {orders.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-white rounded-2xl border border-gray-100 shadow-sm max-w-sm mx-auto animate-in fade-in duration-300">
                                                <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-[#aa1918] mb-4">
                                                    <i className="bi bi-inbox text-xl"></i>
                                                </div>
                                                <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider mb-1">Sin pedidos para hoy</h3>
                                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider leading-relaxed">Aquí aparecerán los pedidos de tus clientes conforme vayan llegando.</p>
                                            </div>
                                        ) : (
                                            <>
                                                {/* Totals Summary for Mobile (Top) */}
                                                <div 
                                                    onClick={() => setSummaryExpanded(!summaryExpanded)}
                                                    className="lg:hidden bg-white rounded-xl border border-gray-100 p-4 mb-4 shadow-sm cursor-pointer hover:bg-gray-50 transition-all"
                                                >
                                                    <div className="grid grid-cols-3 gap-2">
                                                        <div className="text-left">
                                                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Visitas</p>
                                                            <p className="text-lg font-bold text-gray-900 flex items-center gap-1">
                                                                <i className="bi bi-people text-gray-400 text-xs"></i>
                                                                {visitsCount}
                                                            </p>
                                                        </div>

                                                        <div 
                                                            className="text-center px-1 border-x border-gray-100 flex flex-col justify-center overflow-hidden group cursor-pointer hover:bg-gray-50 transition-colors"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                setActiveTab('inventory')
                                                            }}
                                                        >
                                                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1 group-hover:text-blue-500 transition-colors">Stock</p>
                                                            {favIngredients.length > 0 ? (
                                                                <div className="flex items-center justify-between gap-1">
                                                                    <button onClick={prevFav} className="p-1 hover:bg-gray-100 rounded-full shrink-0"><i className="bi bi-chevron-left text-[8px]"></i></button>
                                                                    <div className="min-w-0 text-center">
                                                                        {favStockSummary[currentFavIndex] ? (
                                                                            <>
                                                                                <p className={`text-lg font-black leading-none mb-0.5 ${favStockSummary[currentFavIndex].currentStock <= 5 ? 'text-red-600' : 'text-gray-900'}`}>
                                                                                    {Math.round(favStockSummary[currentFavIndex].currentStock)}
                                                                                </p>
                                                                                <p className="text-[8px] font-bold text-gray-500 truncate leading-tight">{favStockSummary[currentFavIndex].ingredientName}</p>
                                                                            </>
                                                                        ) : (
                                                                            <div className="animate-pulse h-4 w-8 bg-gray-100 rounded mx-auto" />
                                                                        )}
                                                                    </div>
                                                                    <button onClick={nextFav} className="p-1 hover:bg-gray-100 rounded-full shrink-0"><i className="bi bi-chevron-right text-[8px]"></i></button>
                                                                </div>
                                                            ) : (
                                                                <p className="text-[8px] text-gray-300 italic">Sin favs</p>
                                                            )}
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
                                                        {summaryExpanded && (
                                                            <div className="col-span-3 mt-2 pt-2 border-t border-gray-100 animate-in fade-in slide-in-from-top-2 flex justify-end">
                                                                <div className="flex flex-col items-end gap-1">
                                                                    <div 
                                                                        className="group cursor-pointer"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            setActiveTab('expenses')
                                                                        }}
                                                                    >
                                                                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1 group-hover:text-red-500 transition-colors text-right">Gastos</p>
                                                                        <p className="text-sm font-bold text-red-600 transition-all">
                                                                            -${totalTodayExpenses.toFixed(2)}
                                                                        </p>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <p className="text-[10px] text-gray-400 font-medium italic">
                                                                            Neto: ${(totalTodaySales - totalTodayExpenses).toFixed(2)}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col lg:flex-row gap-6 items-start">
                                                {/* Columna 1: Borrador, Pendiente y Live Checkouts */}
                                                <div className={`${showCol1 ? 'block' : 'hidden lg:block'} w-full lg:flex-1 lg:min-w-0 space-y-6`}>
                                                    {businessId && (
                                                        <LiveCheckoutsPanel
                                                            businessId={businessId}
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
                                                        canChangeDelivery={canChangeDelivery}
                                                        canDeleteOrders={canManageRestrictedOrderActions}
                                                        deliveryTimeMinutes={currentDeliveryTime}
                                                        autoPrintOnConfirm={business?.notificationSettings?.autoPrintOnConfirm ?? true}
                                                        clientsWithNotes={clientsWithNotes}
                                                    />
                                                </div>

                                                {/* Columna 2: Confirmados */}
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
                                                        canChangeDelivery={canChangeDelivery}
                                                        canDeleteOrders={canManageRestrictedOrderActions}
                                                        deliveryTimeMinutes={currentDeliveryTime}
                                                        autoPrintOnConfirm={business?.notificationSettings?.autoPrintOnConfirm ?? true}
                                                        clientsWithNotes={clientsWithNotes}
                                                    />
                                                </div>

                                                {/* Columna 3: El resto */}
                                                <div className={`${showCol3 || orders.length > 0 ? 'block' : 'hidden lg:block'} w-full lg:flex-1 lg:min-w-0 space-y-6`}>
                                                    {/* Totals Summary for Desktop ONLY */}
                                                    <div 
                                                        onClick={() => setSummaryExpanded(!summaryExpanded)}
                                                        className="hidden lg:block bg-white rounded-xl border border-gray-100 p-4 shadow-sm cursor-pointer hover:bg-gray-50 transition-all"
                                                    >
                                                        <div className="grid grid-cols-3 gap-4">
                                                            <div className="text-left">
                                                                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Visitas Hoy</p>
                                                                <p className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                                                    <i className="bi bi-people text-gray-400 text-sm"></i>
                                                                    {visitsCount}
                                                                </p>
                                                            </div>

                                                            <div 
                                                                className="text-center px-4 border-x border-gray-100 flex flex-col justify-center group cursor-pointer hover:bg-gray-50 transition-colors"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    setActiveTab('inventory')
                                                                }}
                                                            >
                                                                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1 group-hover:text-blue-500 transition-colors">Stock Favorito</p>
                                                                {favIngredients.length > 0 ? (
                                                                    <div className="flex items-center justify-center gap-4">
                                                                        <button onClick={prevFav} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"><i className="bi bi-chevron-left text-xs"></i></button>
                                                                        <div className="min-w-0">
                                                                            {favStockSummary[currentFavIndex] ? (
                                                                                <>
                                                                                    <p className={`text-xl font-black leading-none mb-1 ${favStockSummary[currentFavIndex].currentStock <= 5 ? 'text-red-600' : 'text-gray-900'}`}>
                                                                                        {Math.round(favStockSummary[currentFavIndex].currentStock)}
                                                                                        <span className="text-[10px] ml-1 uppercase font-bold text-gray-400">{favStockSummary[currentFavIndex].unit || 'uds'}</span>
                                                                                    </p>
                                                                                    <p className="text-xs font-bold text-gray-500 truncate leading-tight">{favStockSummary[currentFavIndex].ingredientName}</p>
                                                                                </>
                                                                            ) : (
                                                                                <div className="animate-pulse h-6 w-12 bg-gray-100 rounded mx-auto" />
                                                                            )}
                                                                        </div>
                                                                        <button onClick={nextFav} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"><i className="bi bi-chevron-right text-xs"></i></button>
                                                                    </div>
                                                                ) : (
                                                                    <p className="text-xs text-gray-300 italic">Sin favoritos marcados</p>
                                                                )}
                                                            </div>

                                                            <div className="text-right">
                                                                <div className="flex flex-col items-end">
                                                                    <p className="text-xl font-bold text-emerald-600">
                                                                        ${totalTodaySales.toFixed(2)}
                                                                    </p>
                                                                    {totalTodayPublicSales > totalTodaySales && (
                                                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                                                            Público: ${totalTodayPublicSales.toFixed(2)}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {summaryExpanded && (
                                                                <div className="col-span-3 mt-2 pt-2 border-t border-gray-100 animate-in fade-in slide-in-from-top-2 flex justify-end px-2">
                                                                    <div className="flex flex-col items-end gap-2">
                                                                        <div 
                                                                            className="group cursor-pointer"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation()
                                                                                setActiveTab('expenses')
                                                                            }}
                                                                        >
                                                                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1 group-hover:text-red-500 transition-colors text-right">Gastos Hoy</p>
                                                                            <p className="text-lg font-bold text-red-600 transition-all">
                                                                                -${totalTodayExpenses.toFixed(2)}
                                                                            </p>
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <p className="text-[10px] text-gray-400 font-medium italic">
                                                                                Neto: ${(totalTodaySales - totalTodayExpenses).toFixed(2)}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
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
                                                        canChangeDelivery={canChangeDelivery}
                                                        canDeleteOrders={canManageRestrictedOrderActions}
                                                        deliveryTimeMinutes={currentDeliveryTime}
                                                        autoPrintOnConfirm={business?.notificationSettings?.autoPrintOnConfirm ?? true}
                                                        clientsWithNotes={clientsWithNotes}
                                                    />
                                                </div>
                                            </div>
                                        </>
                                    )}
                                    </div>
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
                                canChangeDelivery={canChangeDelivery}
                                onDeliveryAssign={handleDeliveryAssignment}
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
                                onOrderCreated={() => {
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
                                setActiveTab={setActiveTab}
                                setProfileSubTab={setProfileSubTab}
                            />

                            <CustomerContactModal
                                isOpen={customerContactModalOpen}
                                onClose={() => setCustomerContactModalOpen(false)}
                                order={selectedOrderForCustomerContact}
                            />
                        </>
                    )}
                    {showAddAdminModal && (
                        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                            <div className="bg-white rounded-lg max-w-md w-full max-h-screen overflow-y-auto">
                                <div className="px-6 py-4 border-b border-gray-200">
                                    <h3 className="text-lg font-medium text-gray-900">
                                        Agregar Administrador
                                    </h3>
                                </div>

                                <div className="px-6 py-4 space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Email del Usuario
                                        </label>
                                        <input
                                            type="email"
                                            value={newAdminData.email}
                                            onChange={(e) => setNewAdminData(prev => ({ ...prev, email: e.target.value }))}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                                            placeholder="usuario@ejemplo.com"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Contrasena de acceso
                                        </label>
                                        <input
                                            type="password"
                                            value={newAdminData.password}
                                            onChange={(e) => setNewAdminData(prev => ({ ...prev, password: e.target.value }))}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                                            placeholder="Minimo 6 caracteres"
                                            autoComplete="new-password"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Si la dejas vacia, solo se agregara el permiso y podra vincular su acceso luego.
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Rol
                                        </label>
                                        <select
                                            value={newAdminData.role}
                                            onChange={(e) => setNewAdminData(prev => ({ ...prev, role: e.target.value as 'admin' | 'manager' }))}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                                        >
                                            <option value="admin">Administrador</option>
                                            <option value="manager">Gerente</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Permisos
                                        </label>
                                        <div className="space-y-2">
                                            {[
                                                { key: 'manageProducts', label: 'Gestionar Productos' },
                                                { key: 'manageOrders', label: 'Gestionar Pedidos' },
                                                { key: 'viewReports', label: 'Ver Reportes' },
                                                { key: 'editBusiness', label: 'Editar Informacion de la Tienda' },
                                                { key: 'manageAdmins', label: 'Gestionar Administradores' },
                                            ].map(({ key, label }) => (
                                                <label key={key} className="flex items-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={newAdminData.permissions[key as keyof typeof newAdminData.permissions]}
                                                        onChange={(e) => setNewAdminData(prev => ({
                                                            ...prev,
                                                            permissions: {
                                                                ...prev.permissions,
                                                                [key]: e.target.checked
                                                            }
                                                        }))}
                                                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                                                    />
                                                    <span className="ml-2 text-sm text-gray-700">{label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
                                    <button
                                        onClick={handleAddAdmin}
                                        disabled={addingAdmin || !newAdminData.email.trim() || (!!newAdminData.password && newAdminData.password.length < 6)}
                                        className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                                    >
                                        {addingAdmin ? (
                                            <>
                                                <i className="bi bi-arrow-clockwise animate-spin me-2"></i>
                                                Agregando...
                                            </>
                                        ) : (
                                            <>
                                                <i className="bi bi-check me-2"></i>
                                                Agregar
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => setShowAddAdminModal(false)}
                                        disabled={addingAdmin}
                                        className="w-full sm:w-auto bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {passwordAdminEmail && (
                        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                            <div className="bg-white rounded-lg max-w-md w-full">
                                <div className="px-6 py-4 border-b border-gray-200">
                                    <h3 className="text-lg font-medium text-gray-900">
                                        Editar acceso
                                    </h3>
                                    <p className="text-sm text-gray-500 mt-1">{passwordAdminEmail}</p>
                                </div>

                                <div className="px-6 py-4">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Nueva contrasena
                                    </label>
                                    <input
                                        type="password"
                                        value={adminPassword}
                                        onChange={(e) => setAdminPassword(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                                        placeholder="Minimo 6 caracteres"
                                        autoComplete="new-password"
                                    />
                                    <p className="text-xs text-gray-500 mt-2">
                                        Esto creara el usuario si no existe o actualizara su contrasena si ya existe.
                                    </p>
                                </div>

                                <div className="px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
                                    <button
                                        onClick={handleSaveAdminPassword}
                                        disabled={savingAdminPassword || adminPassword.length < 6}
                                        className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                                    >
                                        {savingAdminPassword ? (
                                            <>
                                                <i className="bi bi-arrow-clockwise animate-spin me-2"></i>
                                                Guardando...
                                            </>
                                        ) : (
                                            <>
                                                <i className="bi bi-key me-2"></i>
                                                Guardar acceso
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => {
                                            setPasswordAdminEmail(null)
                                            setAdminPassword('')
                                        }}
                                        disabled={savingAdminPassword}
                                        className="w-full sm:w-auto bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            </div>
                        </div>
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
    onWhatsApp
}: {
    isOpen: boolean,
    onClose: () => void,
    order: Order | null,
    deliveryAgent?: Delivery,
    availableDeliveries: Delivery[],
    canChangeDelivery: boolean,
    onDeliveryAssign: (id: string, deliveryId: string) => void | Promise<void>,
    onWhatsApp: () => void
}) {
    if (!isOpen || !order) return null

    const status = order.delivery?.acceptanceStatus
    const agentCardClass = !order.delivery?.assignedDelivery
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
                        {/* Agent Info */}
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

                        {/* Confirmation Status */}
                        {false && <div className="flex items-start gap-3">
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
                        </div>}

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

const getActionEmoji = (status: string) => {
    switch (status) {
        case 'preparing': return '🔥'
        case 'ready': return '✔️'
        case 'on_way': return '🛵'
        case 'delivered': return '🎉'
        default: return '➡️'
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
    clientsWithNotes
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
                        {statusOrders.map((order: any) => (
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
                             />
                        ))}
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
    clientsWithNotes
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
    clientsWithNotes?: Record<string, string>
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

    // Prevent scroll when modal is open
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
        <div className={`bg-white rounded-xl shadow-sm border border-gray-100 transition-all ${statusMenuOpen ? 'relative z-30' : ''} ${urgent ? 'animate-pulse border-red-300 ring-2 ring-red-100' : ''}`}>
            {/* Confirmation Modal for Discard */}
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

                        {/* Reason Selector */}
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
            {/* Card Header: Time & Status */}
            <div
                className={`px-4 py-3 border-b cursor-pointer transition-colors ${isExpanded ? 'border-gray-200 bg-gray-200 hover:bg-gray-200' : 'border-gray-50 bg-gray-50/50 hover:bg-gray-100'}`}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* First Row: Customer, Time & Buttons */}
                <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-3">
                        {/* Column for expand/collapse chevron + mobile icon */}
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

                            <div className="flex items-center gap-2 mt-0.5">
                                <i className={`bi ${order.timing?.type === 'scheduled' ? 'bi-clock' : 'bi-lightning-fill'} ${order.timing?.type === 'scheduled' ? 'text-blue-600' : 'text-yellow-500'}`}></i>
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
                        {/* Advance Status */}
                        {primaryActionStatus && (
                            <button
                                onClick={() => {
                                    // Si el siguiente estado es 'confirmed', verificar el tipo de timing
                                    if (primaryActionStatus === 'confirmed') {
                                        onStatusChange(order.id, 'confirmed');
                                        
                                        // Imprimir automáticamente (silenciosamente)
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

                        {/* Preparing Button for Confirmed Scheduled Orders (within 30 minutes) */}
                        {false && (
                            <button
                                onClick={() => onStatusChange(order.id, 'preparing')}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-purple-600 text-white rounded-lg transition-colors shadow-sm hover:bg-purple-700"
                                title="Iniciar preparación"
                            >
                                <span>En preparación</span>
                                <i className="bi bi-fire"></i>
                            </button>
                        )}

                        {/* Discard Button for Pending Orders */}
                        {order.status === 'pending' && (
                            <button
                                onClick={() => setConfirmDiscardOpen(true)}
                                className="p-1.5 text-lg text-gray-400 bg-gray-50 border border-gray-100 rounded-lg hover:bg-gray-100 transition-colors shadow-sm"
                                title="Descartar pedido"
                            >
                                <i className="bi bi-x-lg"></i>
                            </button>
                        )}

                        {/* Status Select Menu */}
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
                        {sortedItems.map((item: any, idx) => {
                            return (
                                <div key={idx} className="text-lg sm:text-sm leading-tight text-gray-600">
                                    {item.quantity}x {item.variant || item.product?.name || item.name}
                                </div>
                            )
                        })}
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
                    {/* Customer Info */}
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
                                                    title="Abrir ubicacion en Maps"
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

                    {/* Notes - Show only if exists */}
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

                    {/* Items */}
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

                        {/* Print Button */}
                        <button
                            onClick={() => onPrint()}
                            className="p-2 text-gray-400 hover:text-gray-600"
                        >
                            <i className="bi bi-printer"></i>
                        </button>
                    </div>

                    {/* Actions: Edit & Delete */}
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
