'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Business, Order, Delivery, Product, BusinessAdministrator } from '@/types'
import { useBusinessAuth } from '@/contexts/BusinessAuthContext'
import { db } from '@/lib/firebase'
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, Timestamp } from 'firebase/firestore'
import {
    getBusiness,
    getProductsByBusiness,
    deleteOrder,
    getDeliveriesByStatus,
    updateOrderStatus,
    updateBusiness,
    getUserBusinessAccess,
    getTodayVisitsDocRef,
    getOrdersByBusinessPaginated,
    uploadImage,
    addBusinessAdministrator,
    updateBusinessAdministrator,
    removeBusinessAdministrator,
    getAllBusinesses,
    getProductsByIds
} from '@/lib/database'
import {
    sendWhatsAppToDelivery,
    getNextStatus
} from '@/components/WhatsAppUtils'
import { isStoreOpen, calculateManualStatusExpiry } from '@/lib/store-utils'
import QueueStatusIndicator from '@/components/QueueStatusIndicator'
import NotificationsBell from '@/components/NotificationsBell'
import DailyCheckInBanner from '@/components/DailyCheckInBanner'
import { useOfflineQueue } from '@/hooks/useOfflineQueue'
import { auth } from '@/lib/firebase'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import DashboardSidebar from '@/components/DashboardSidebar'
import { optimizeImage } from '@/lib/image-utils'

// Dashboard-specific imports (extracted modules)
import {
    toSafeDate,
    toLocalDateInputValue,
    isActiveDashboardOrder,
    getConfiguredDeliveryTime,
    getStatusText,
    getStatusColor,
    autoAssignDeliveryForOrder,
    MUNCHYS_BUSINESS_ID,
} from './dashboard-utils'
import { OrderStatusColumn } from './OrderStatusColumn'
import { DeliveryStatusModal } from './DeliveryStatusModal'
import { CustomerContactModal } from './CustomerContactModal'

// Lazy-loaded components
const ProductList = dynamic(() => import('@/components/ProductList'), { ssr: false })
const DayPreflightChecklist = dynamic(() => import('@/components/DayPreflightChecklist'), { ssr: false })
const OrderHistory = dynamic(() => import('@/components/OrderHistory'), {
    loading: () => (
        <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
        </div>
    ),
    ssr: false
})
const StatisticsView = dynamic(() => import('@/components/StatisticsView'), { ssr: false })
const WalletView = dynamic(() => import('@/components/WalletView'), { ssr: false })
const IngredientStockManagement = dynamic(() => import('@/components/IngredientStockManagement'), { ssr: false })
const CostReports = dynamic(() => import('@/components/CostReports'), { ssr: false })
const BusinessProfileDashboard = dynamic(() => import('@/components/BusinessProfileDashboard'), { ssr: false })
const BusinessProfileEditor = dynamic(() => import('@/components/BusinessProfileEditor'), { ssr: false })
const AdministratorsManagementView = dynamic(() => import('@/components/AdministratorsManagementView'), { ssr: false })
const QRCodesContent = dynamic(() => import('@/app/business/qr-codes/qr-codes-content'), { ssr: false })
const ExpensesView = dynamic(() => import('@/components/ExpensesView'), { ssr: false })

import type { CheckoutSession } from '@/components/LiveCheckoutsPanel'
const PaymentManagementModals = dynamic(() => import('@/components/PaymentManagementModals'), { ssr: false })
const ManualOrderSidebar = dynamic(() => import('@/components/ManualOrderSidebar'), { ssr: false })
const LiveCheckoutsPanel = dynamic(() => import('@/components/LiveCheckoutsPanel').then(m => m.LiveCheckoutsPanel), { ssr: false })

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
    const [toast, setToast] = useState<{ show: boolean; message: string; icon?: string } | null>(null)

    const showToastMessage = (message: string, icon: string = 'bi-printer') => {
        setToast({ show: true, message, icon })
        setTimeout(() => {
            setToast(null)
        }, 2500)
    }
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
    const [activeTab, setActiveTab] = useState<'orders' | 'profile' | 'admins' | 'reports' | 'inventory' | 'qrcodes' | 'stats' | 'wallet' | 'checklist' | 'expenses'>('orders')
    const [profileSubTab, setProfileSubTab] = useState<'general' | 'products' | 'fidelizacion' | 'notifications' | 'admins' | 'configuracion' | 'sucursales'>('general')
    const [reportsSubTab, setReportsSubTab] = useState<'general' | 'costs'>('general')
    const [isTiendaMenuOpen, setIsTiendaMenuOpen] = useState(false)
    const [isReportsMenuOpen, setIsReportsMenuOpen] = useState(false)
    const [summaryExpanded, setSummaryExpanded] = useState(false)

    // Load today's expenses — DEFERRED: subscribe after 3s to reduce initial burst
    const [todayExpenses, setTodayExpenses] = useState<any[]>([])

    useEffect(() => {
        if (!businessId) return

        const timer = setTimeout(() => {
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

            // Store cleanup for when the effect is cleaned up
            cleanupRef.current = unsubscribe
        }, 3000)

        const cleanupRef = { current: () => {} }

        return () => {
            clearTimeout(timer)
            cleanupRef.current()
        }
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

    // Core state
    const [orders, setOrders] = useState<Order[]>([])
    const [loading, setLoading] = useState(true)
    const [availableDeliveries, setAvailableDeliveries] = useState<Delivery[]>([])
    const [business, setBusiness] = useState<Business | null>(null)
    const [copiedLink, setCopiedLink] = useState(false)
    const [origin, setOrigin] = useState('')
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

    // Cache de notas de clientes — DEFERRED: load after 5s to reduce initial burst
    const [clientsWithNotes, setClientsWithNotes] = useState<Record<string, string>>({})

    useEffect(() => {
        const timer = setTimeout(() => {
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
        }, 5000)

        return () => clearTimeout(timer)
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
    
    // Resetear productos cargados cuando cambie el negocio/sucursal
    useEffect(() => {
        setProductsLoaded(false)
        setProducts([])
    }, [businessId])

    // OPTIMIZED: Load products when needed (products tab, manual order sidebar) OR in background after initial dashboard load (!loading)
    const needsProducts = (activeTab === 'profile' && profileSubTab === 'products') || manualOrderSidebarOpen || !loading
    
    useEffect(() => {
        if (!businessId) return
        if (!needsProducts) return

        if (!productsLoaded && !productsLoading) {
            const fetchProducts = async () => {
                setProductsLoading(true)
                try {
                    let productsData = await getProductsByBusiness(businessId)
                    try {
                        const biz = business || await getBusiness(businessId)
                        if (biz?.sharedProductIds && biz.sharedProductIds.length > 0) {
                            const sharedProds = await getProductsByIds(biz.sharedProductIds)
                            const allBizs = await getAllBusinesses()
                            const { isStoreOpen: isOpen } = await import('@/lib/store-utils')
                            const avShared = sharedProds
                                .filter(p => {
                                    if (!p.isAvailable) return false
                                    const ownerBiz = allBizs.find(b => b.id === p.businessId)
                                    if (!ownerBiz) return false
                                    if (ownerBiz.isActive === false) return false
                                    return isOpen(ownerBiz)
                                })
                                .map(p => {
                                    const ownerBiz = allBizs.find(b => b.id === p.businessId)
                                    return {
                                        ...p,
                                        category: 'Compartidos',
                                        isShared: true,
                                        originalBusinessId: p.businessId,
                                        originalBusinessName: ownerBiz?.name || 'Otra tienda',
                                        originalBusinessImage: ownerBiz?.image || null
                                    }
                                })
                            productsData = [...productsData, ...avShared]
                        }
                    } catch (e) {
                        console.error("Error loading shared products in dashboard:", e)
                    }
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
    }, [businessId, productsLoaded, productsLoading, business, needsProducts])

    // Sold units per day calculation state & memo
    const [currentUnitsIndex, setCurrentUnitsIndex] = useState(0)

    const todaySoldUnitsSummary = useMemo(() => {
        const activeOrders = orders.filter(o => o.status !== 'cancelled')

        const ingredientMap = new Map<string, { name: string; quantity: number; unit?: string; isIngredient: boolean }>()
        let totalUnitsCount = 0

        activeOrders.forEach(order => {
            if (!order.items || !Array.isArray(order.items)) return

            order.items.forEach(item => {
                const itemQty = Number(item.quantity) || 1

                let ingredientsToUse: any[] = []

                // 1. Check if ingredients are directly stored on item snapshot
                const itemIngredients = (item as any).ingredients
                if (itemIngredients && Array.isArray(itemIngredients) && itemIngredients.length > 0) {
                    ingredientsToUse = itemIngredients
                } else {
                    const productId = item.product?.id || (item as any).productId || (item as any).id
                    const productName = item.name || item.product?.name
                    const product = products.find(p => p.id === productId) || (productName ? products.find(p => p.name === productName) : undefined) || item.product

                    if (product) {
                        // 2. Check combo selections (if item is a combo product with comboSelection)
                        const comboSelection = (item as any).comboSelection
                        if (comboSelection && typeof comboSelection === 'object' && product.variants && Array.isArray(product.variants)) {
                            const comboIngs: any[] = []
                            Object.entries(comboSelection).forEach(([variantName, selQty]) => {
                                const selCount = Number(selQty) || 0
                                if (selCount > 0) {
                                    const variantObj = product.variants?.find((v: any) => v.name === variantName || v.id === variantName)
                                    if (variantObj?.ingredients && Array.isArray(variantObj.ingredients)) {
                                        variantObj.ingredients.forEach((ing: any) => {
                                            comboIngs.push({
                                                ...ing,
                                                quantity: (Number(ing.quantity) || 1) * selCount
                                            })
                                        })
                                    }
                                }
                            })
                            if (comboIngs.length > 0) {
                                ingredientsToUse = comboIngs
                            }
                        }

                        // 3. Single variant ingredients
                        if (ingredientsToUse.length === 0) {
                            const variantName = item.variant || (item as any).variantName
                            const variantId = (item as any).variantId
                            if ((variantName || variantId) && product.variants && Array.isArray(product.variants)) {
                                const variantObj = product.variants.find((v: any) =>
                                    (variantId && v.id === variantId) ||
                                    (variantName && v.name === variantName)
                                )
                                if (variantObj?.ingredients && Array.isArray(variantObj.ingredients) && variantObj.ingredients.length > 0) {
                                    ingredientsToUse = variantObj.ingredients
                                }
                            }
                        }

                        // 4. Product-level ingredients
                        if (ingredientsToUse.length === 0 && product.ingredients && Array.isArray(product.ingredients) && product.ingredients.length > 0) {
                            ingredientsToUse = product.ingredients
                        }
                    }
                }

                if (ingredientsToUse.length > 0) {
                    ingredientsToUse.forEach(ing => {
                        const ingQty = (Number(ing.quantity) || 1) * itemQty
                        const ingName = (ing.name || 'Ingrediente').trim()
                        const normKey = ingName.toLowerCase()

                        totalUnitsCount += ingQty

                        const existing = ingredientMap.get(normKey)
                        if (existing) {
                            existing.quantity += ingQty
                        } else {
                            ingredientMap.set(normKey, {
                                name: ingName,
                                quantity: ingQty,
                                unit: ing.unit || 'uds',
                                isIngredient: true
                            })
                        }
                    })
                } else {
                    totalUnitsCount += itemQty
                    const prodName = item.name || item.product?.name || 'Producto'
                    const normKey = prodName.toLowerCase()
                    const existing = ingredientMap.get(normKey)
                    if (existing) {
                        existing.quantity += itemQty
                    } else {
                        ingredientMap.set(normKey, {
                            name: prodName,
                            quantity: itemQty,
                            unit: 'uds',
                            isIngredient: false
                        })
                    }
                }
            })
        })

        const ingredientsList = Array.from(ingredientMap.values()).sort((a, b) => b.quantity - a.quantity)

        const slides = ingredientsList.map(ing => ({
            value: ing.quantity,
            label: ing.name,
            unit: ing.unit || 'uds',
            isIngredient: ing.isIngredient
        }))

        return {
            totalUnitsCount,
            ingredientsList,
            slides
        }
    }, [orders, products])

    const activeUnitsSlide = todaySoldUnitsSummary.slides.length > 0
        ? todaySoldUnitsSummary.slides[currentUnitsIndex % todaySoldUnitsSummary.slides.length]
        : null

    const nextUnitsSlide = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (todaySoldUnitsSummary.slides.length === 0) return
        setCurrentUnitsIndex(prev => (prev + 1) % todaySoldUnitsSummary.slides.length)
    }

    const prevUnitsSlide = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (todaySoldUnitsSummary.slides.length === 0) return
        setCurrentUnitsIndex(prev => (prev - 1 + todaySoldUnitsSummary.slides.length) % todaySoldUnitsSummary.slides.length)
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
    const [userRole, setUserRole] = useState<'owner' | 'admin' | 'manager' | 'atencion_cliente' | null>(null)
    const [currentUserPermissions, setCurrentUserPermissions] = useState<BusinessAdministrator['permissions'] | null>(null)
    const [savingProfile, setSavingProfile] = useState(false)
    const [showAddAdminModal, setShowAddAdminModal] = useState(false)
    const [newAdminData, setNewAdminData] = useState({
        email: '',
        password: '',
        role: 'admin' as 'admin' | 'manager' | 'atencion_cliente',
        permissions: {
            manageProducts: true,
            manageOrders: true,
            deleteOrders: true,
            managePromotions: false,
            manageAdmins: false,
            viewReports: true,
            manageInventory: false,
            viewFinances: false,
            editBusiness: false
        }
    })
    const [addingAdmin, setAddingAdmin] = useState(false)
    const [passwordAdminEmail, setPasswordAdminEmail] = useState<string | null>(null)
    const [adminPassword, setAdminPassword] = useState('')
    const [savingAdminPassword, setSavingAdminPassword] = useState(false)

    // Determine user role and permissions
    useEffect(() => {
        if (!business || !user) return
        const isOwner = business.ownerId === user.uid
        if (isOwner) {
            setUserRole('owner')
            setCurrentUserPermissions({
                manageOrders: true,
                deleteOrders: true,
                manageProducts: true,
                managePromotions: true,
                viewReports: true,
                manageInventory: true,
                viewFinances: true,
                editBusiness: true,
                manageAdmins: true
            })
        } else {
            const adminEntry = business.administrators?.find(a => a.email?.toLowerCase() === user.email?.toLowerCase())
            const role = (adminEntry?.role as any) || 'admin'
            setUserRole(role)
            setCurrentUserPermissions(adminEntry?.permissions || null)
        }
    }, [business, user])

    // Redirigir a orders si atencion_cliente intenta acceder a rutas restringidas
    useEffect(() => {
        if (userRole === 'atencion_cliente') {
            const restrictedTabs = ['stats', 'wallet', 'expenses', 'inventory', 'reports', 'admins']
            const restrictedProfileSubTabs = ['general', 'configuracion', 'sucursales', 'admins', 'fidelizacion']
            if (restrictedTabs.includes(activeTab)) {
                setActiveTab('orders')
            } else if (activeTab === 'profile' && restrictedProfileSubTabs.includes(profileSubTab)) {
                setActiveTab('orders')
            }
        }
    }, [userRole, activeTab, profileSubTab])

    const canManageAdmins = userRole === 'owner' || !!business?.administrators?.some(admin =>
        admin.email?.toLowerCase() === user?.email?.toLowerCase() && admin.permissions?.manageAdmins
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
            const timestamp = Date.now()
            const optimizedBlob = await optimizeImage(file, 1200, 0.7, 'image/jpeg')
            const optimizedFile = new File(
                [optimizedBlob],
                `${timestamp}_${file.name.split('.')[0]}.jpg`,
                { type: optimizedBlob.type || 'image/jpeg' }
            )
            const path = `businesses/covers/${business.id}_${timestamp}_${file.name.split('.')[0]}.jpg`
            const imageUrl = await uploadImage(optimizedFile, path)
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
            const timestamp = Date.now()
            const optimizedBlob = await optimizeImage(file, 500, 0.8, 'image/jpeg')
            const optimizedFile = new File(
                [optimizedBlob],
                `${timestamp}_${file.name.split('.')[0]}.jpg`,
                { type: optimizedBlob.type || 'image/jpeg' }
            )
            const path = `businesses/profiles/${business.id}_${timestamp}_${file.name.split('.')[0]}.jpg`
            const imageUrl = await uploadImage(optimizedFile, path)
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
            const timestamp = Date.now()
            const optimizedBlob = await optimizeImage(file, 800, 0.7, 'image/jpeg')
            const optimizedFile = new File(
                [optimizedBlob],
                `${timestamp}_${file.name.split('.')[0]}.jpg`,
                { type: optimizedBlob.type || 'image/jpeg' }
            )
            const path = `businesses/locations/${business.id}_${timestamp}_${file.name.split('.')[0]}.jpg`
            const imageUrl = await uploadImage(optimizedFile, path)
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

    const handleAddAdminData = async (adminData: {
        email: string
        password?: string
        role: 'admin' | 'manager' | 'atencion_cliente'
        permissions: BusinessAdministrator['permissions']
    }) => {
        if (!business) return
        const currentUser = auth.currentUser
        if (!currentUser) throw new Error('Usuario no autenticado')

        if (adminData.password && adminData.password.trim()) {
            const token = await currentUser.getIdToken()
            const response = await fetch('/api/business/admin-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    businessId: business.id,
                    email: adminData.email.trim(),
                    password: adminData.password,
                    role: adminData.role,
                    permissions: adminData.permissions
                })
            })
            const result = await response.json()
            if (!response.ok) {
                throw new Error(result.error || 'Error al crear el acceso del administrador')
            }
        } else {
            await addBusinessAdministrator(
                business.id,
                adminData.email.trim(),
                adminData.role,
                adminData.permissions,
                currentUser.uid
            )
        }

        const updatedBusiness = await getBusiness(business.id)
        if (updatedBusiness) {
            setBusiness(updatedBusiness)
            setBusinesses(prev => prev.map(b => b.id === business.id ? updatedBusiness : b))
        }
    }

    const handleUpdateAdminData = async (adminData: {
        email: string
        role: 'admin' | 'manager' | 'atencion_cliente'
        permissions: BusinessAdministrator['permissions']
    }) => {
        if (!business) return
        await updateBusinessAdministrator(
            business.id,
            adminData.email.trim(),
            adminData.role,
            adminData.permissions
        )

        const updatedBusiness = await getBusiness(business.id)
        if (updatedBusiness) {
            setBusiness(updatedBusiness)
            setBusinesses(prev => prev.map(b => b.id === business.id ? updatedBusiness : b))
        }
    }

    const handleSaveAdminPasswordData = async (email: string, password: string) => {
        if (!business) return
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
                email: email.trim(),
                password: password
            })
        })
        const result = await response.json()
        if (!response.ok) {
            throw new Error(result.error || 'Error al guardar la contraseña')
        }

        const updatedBusiness = await getBusiness(business.id)
        if (updatedBusiness) {
            setBusiness(updatedBusiness)
            setBusinesses(prev => prev.map(b => b.id === business.id ? updatedBusiness : b))
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

    // Auto-repair & cleanup effect for manual store status
    useEffect(() => {
        if (!business?.id || !business.manualStoreStatus) return

        const repairOrCleanup = async () => {
            // Case 1: Manual status exists but has no expiry → calculate and set one
            if (!business.manualStatusExpiry) {
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
                return
            }

            // Case 2: Manual status has expired → clean up both fields
            const expiry = toSafeDate(business.manualStatusExpiry)
            if (expiry && new Date() >= expiry) {
                console.log('🧹 [Cleanup] Manual status expired for:', business.name, '- clearing...')
                try {
                    await updateBusiness(business.id, { manualStoreStatus: null as any, manualStatusExpiry: null as any })
                    console.log('✅ [Cleanup] Manual status cleared for:', business.name)
                    setBusiness(prev => prev?.id === business.id ? { ...prev, manualStoreStatus: undefined, manualStatusExpiry: undefined } : prev)
                } catch (err) {
                    console.error('❌ [Cleanup] Failed to clear expired manual status:', err)
                }
            }
        }
        repairOrCleanup()
    }, [business?.id, business?.manualStoreStatus, !!business?.manualStatusExpiry])

    // Load visits count — DEFERRED: subscribe after 3s to reduce initial burst
    const [visitsCount, setVisitsCount] = useState(0)

    useEffect(() => {
        if (!businessId) return

        const timer = setTimeout(() => {
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

            cleanupRef.current = unsubscribe
        }, 3000)

        const cleanupRef = { current: () => {} }

        return () => {
            clearTimeout(timer)
            cleanupRef.current()
        }
    }, [businessId])

    // Fetch products (Lazy loading)
    useEffect(() => {
        // Reset products state when business changes
        setProductsLoaded(false)
        setProducts([])
    }, [businessId])



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

        // Solo mostrar pantalla de carga en la primera apertura absoluta del dashboard
        setLoading(prev => business ? false : prev)
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
                // OPTIMIZED: Set first load flag directly instead of polling with setInterval
                isFirstOrdersLoad.current = false
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

        // Listener 5: Multi-store active orders where this business is a participant
        const qMultiStore = query(
            collection(db, 'orders'),
            where('businessIds', 'array-contains', businessId),
            where('status', 'in', ['borrador', 'pending', 'confirmed', 'preparing', 'ready', 'on_way'])
        )
        const unsubMultiStore = onSnapshot(qMultiStore, (snapshot) => {
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
            updateOrdersState()
        }, (error) => {
            console.error("Error in unsubMultiStore:", error)
        })

        // REMOVED: loadLegacyScheduledToday — the 4 listeners above already cover all scheduled date formats
        // REMOVED: setInterval polling for first load — now set directly in updateOrdersState

        return () => {
            unsubCreated()
            unsubActive()
            unsubScheduled()
            unsubScheduledString()
            unsubMultiStore()
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
        if (!newBusinessId || newBusinessId === businessId) return;
        const found = businesses.find(b => b.id === newBusinessId);
        if (found) {
            setBusiness(found);
        }
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

            // Auto-assign delivery logic
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

    const handleOrderUpdatedFromModal = (updatedOrder: Order) => {
        updateOrderEverywhere(updatedOrder)
    }

    const handleSendWhatsAppToDelivery = async (order: Order) => {
        try {
            const orderBusiness = businesses.find(b => b.id === order.businessId) || business
            await sendWhatsAppToDelivery(
                order,
                availableDeliveries,
                orderBusiness
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
            businessId: checkoutSession.businessId || checkoutSession.cartItems?.[0]?.originalBusinessId || '',
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

    const canDeleteOrders = userRole === 'owner' ||
        userRole === 'atencion_cliente' ||
        userRole === 'admin' ||
        userRole === 'manager' ||
        currentUserPermissions?.deleteOrders !== false ||
        currentUserPermissions?.manageOrders !== false ||
        business?.id === MUNCHYS_BUSINESS_ID
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
                    currentBusinessName={businesses.find(b => b.id === businessId)?.name}
                    userRole={userRole}
                    permissions={currentUserPermissions || undefined}
                    canManageAdmins={canManageAdmins}
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
                                            <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-[60]">
                                                <div className="px-4 py-2 border-b border-gray-100">
                                                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Tus Tiendas y Sucursales</p>
                                                </div>
                                                <div className="max-h-72 overflow-y-auto">
                                                    {businesses.map((biz) => {
                                                        const isSelected = business?.id === biz.id
                                                        return (
                                                            <button
                                                                key={biz.id}
                                                                onClick={() => { handleBusinessChange(biz.id); setShowBusinessDropdown(false); }}
                                                                className={`w-full flex items-center space-x-3 px-4 py-3 text-left hover:bg-rose-50/50 transition-colors ${isSelected ? 'bg-rose-50/80 font-bold' : ''}`}
                                                            >
                                                                <div className="w-9 h-9 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0 border border-gray-200/80">
                                                                    {biz.image ? <img src={biz.image} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-400"><i className="bi bi-shop"></i></div>}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm font-bold text-gray-900 truncate">
                                                                        {biz.name}
                                                                    </p>
                                                                    {biz.branchName && biz.branchName !== biz.name ? (
                                                                        <span className="text-[11px] font-semibold text-rose-600 bg-rose-100/60 px-1.5 py-0.2 rounded inline-block truncate max-w-full">
                                                                            {biz.branchName}
                                                                        </span>
                                                                    ) : biz.isBranch ? (
                                                                        <span className="text-[11px] font-medium text-gray-500">
                                                                            Sucursal
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                                    <a
                                                                        href={`/${biz.username}`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-100/50 rounded-lg transition-all"
                                                                        title="Ver tienda pública"
                                                                    >
                                                                        <i className="bi bi-box-arrow-up-right text-sm"></i>
                                                                    </a>
                                                                    {isSelected && <i className="bi bi-check-circle-fill text-rose-600 text-base"></i>}
                                                                </div>
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                                <hr className="my-1 border-gray-100" />
                                                <button onClick={handleLogout} className="w-full flex items-center space-x-3 px-4 py-2.5 text-left hover:bg-rose-50 text-rose-600 text-sm font-bold transition-colors">
                                                    <i className="bi bi-box-arrow-right text-base"></i>
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
                    {activeTab === 'admins' || (activeTab === 'profile' && profileSubTab === 'admins') ? (
                        <div className="p-4 sm:p-6">
                            {business && (
                                <AdministratorsManagementView
                                    business={business}
                                    currentUserEmail={user?.email}
                                    currentUserRole={userRole}
                                    onAddAdmin={handleAddAdminData}
                                    onUpdateAdmin={handleUpdateAdminData}
                                    onSaveAdminPassword={handleSaveAdminPasswordData}
                                    onRemoveAdmin={handleRemoveAdmin}
                                    onTransferOwnership={handleTransferOwnership}
                                />
                            )}
                        </div>
                    ) : activeTab === 'stats' ? (
                        <div className="p-4 sm:p-6">
                            <StatisticsView key={business?.id} orders={[...orders, ...historicalOrders]} businessId={business?.id} />
                        </div>
                    ) : activeTab === 'wallet' ? (
                        <div className="p-4 sm:p-6">
                            {business && <WalletView business={business} orders={orders} historicalOrders={historicalOrders} />}
                        </div>
                    ) : activeTab === 'expenses' ? (
                        <div className="p-4 sm:p-6">
                            <ExpensesView business={business} user={user} />
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
                                    onSwitchBusiness={handleBusinessChange}
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
                            <ProductList
                                business={business}
                                onBusinessChange={handleBusinessChange}
                                products={products}
                                categories={categories}
                                onProductsChange={handleProductsChange}
                                onCategoriesChange={handleCategoriesChange}
                                onDirectUpdate={handleDirectUpdate}
                            />
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
                                        onOrderDelete={canDeleteOrders ? (id) => handleDeleteOrder(id) : undefined}
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
                                        canDeleteOrders={canDeleteOrders}
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
                                        {/* Daily Check-in Banner */}
                                        {business && business.requireDailyCheckIn && (
                                            <DailyCheckInBanner
                                                business={business}
                                                onBusinessUpdate={(updated) => {
                                                    setBusiness(prev => prev ? { ...prev, ...updated } : prev)
                                                }}
                                            />
                                        )}

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
                                                                setActiveTab('stats')
                                                            }}
                                                        >
                                                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1 group-hover:text-blue-500 transition-colors">
                                                                {activeUnitsSlide ? (activeUnitsSlide.isIngredient ? 'Ingrediente' : 'Producto') : 'Ingredientes'}
                                                            </p>
                                                            <div className="flex items-center justify-between gap-1">
                                                                {todaySoldUnitsSummary.slides.length > 1 && (
                                                                    <button onClick={prevUnitsSlide} className="p-1 hover:bg-gray-100 rounded-full shrink-0"><i className="bi bi-chevron-left text-[8px]"></i></button>
                                                                )}
                                                                <div className="min-w-0 text-center flex-1">
                                                                    {activeUnitsSlide ? (
                                                                        <>
                                                                            <p className="text-lg font-black leading-none mb-0.5 text-gray-900">
                                                                                {Math.round(activeUnitsSlide.value)}
                                                                            </p>
                                                                            <p className="text-[8px] font-bold text-gray-500 truncate leading-tight">
                                                                                {activeUnitsSlide.label}
                                                                            </p>
                                                                        </>
                                                                    ) : (
                                                                        <p className="text-lg font-black leading-none mb-0.5 text-gray-900">0</p>
                                                                    )}
                                                                </div>
                                                                {todaySoldUnitsSummary.slides.length > 1 && (
                                                                    <button onClick={nextUnitsSlide} className="p-1 hover:bg-gray-100 rounded-full shrink-0"><i className="bi bi-chevron-right text-[8px]"></i></button>
                                                                )}
                                                            </div>
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
                                                        canDeleteOrders={canDeleteOrders}
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
                                                        canDeleteOrders={canDeleteOrders}
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
                                                                    setActiveTab('stats')
                                                                }}
                                                            >
                                                                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1 group-hover:text-blue-500 transition-colors">
                                                                    {activeUnitsSlide ? (activeUnitsSlide.isIngredient ? 'Ingredientes Vendidos Hoy' : 'Productos Vendidos Hoy') : 'Ingredientes Vendidos Hoy'}
                                                                </p>
                                                                <div className="flex items-center justify-center gap-4">
                                                                    {todaySoldUnitsSummary.slides.length > 1 && (
                                                                        <button onClick={prevUnitsSlide} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"><i className="bi bi-chevron-left text-xs"></i></button>
                                                                    )}
                                                                    <div className="min-w-0 text-center">
                                                                        {activeUnitsSlide ? (
                                                                            <>
                                                                                <p className="text-xl font-black leading-none mb-1 text-gray-900">
                                                                                    {Math.round(activeUnitsSlide.value)}
                                                                                    <span className="text-[10px] ml-1 uppercase font-bold text-gray-400">{activeUnitsSlide.unit}</span>
                                                                                </p>
                                                                                <p className="text-xs font-bold text-gray-500 truncate leading-tight">{activeUnitsSlide.label}</p>
                                                                            </>
                                                                        ) : (
                                                                            <p className="text-xl font-black leading-none mb-1 text-gray-900">
                                                                                0 <span className="text-[10px] ml-1 uppercase font-bold text-gray-400">uds</span>
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                    {todaySoldUnitsSummary.slides.length > 1 && (
                                                                        <button onClick={nextUnitsSlide} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"><i className="bi bi-chevron-right text-xs"></i></button>
                                                                    )}
                                                                </div>
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
                                                        canDeleteOrders={canDeleteOrders}
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
                                onBusinessChange={handleBusinessChange}
                                loadingBusinessProducts={productsLoading}
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
            </div>
        </div>
    )
}
