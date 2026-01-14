'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Business, Product, Order, ProductVariant, ClientLocation, PaymentInfo } from '@/types'
import { User as FirebaseUser } from 'firebase/auth'
import { auth, db } from '@/lib/firebase'
import { printOrder } from '@/lib/print-utils'
import { doc, updateDoc, Timestamp } from 'firebase/firestore'
import { useBusinessAuth } from '@/contexts/BusinessAuthContext'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import ManualOrderSidebar from '@/components/ManualOrderSidebar'
import CostReports from '@/components/CostReports'
import NotificationsBell from '@/components/NotificationsBell'
import IngredientStockManagement from '@/components/IngredientStockManagement'
import { sendWhatsAppToDelivery, sendWhatsAppToCustomer } from '@/components/WhatsAppUtils'
import BusinessProfileDashboard from '@/components/BusinessProfileDashboard'
import {
  getBusiness,
  getProductsByBusiness,
  getRecentOrdersByBusiness,
  getHistoricalOrdersByBusiness,
  updateOrderStatus,
  updateProduct,
  deleteProduct,
  getBusinessesByOwner,
  uploadImage,
  updateBusiness,
  addBusinessAdministrator,
  removeBusinessAdministrator,
  updateAdministratorPermissions,
  getUserBusinessAccess,
  getBusinessCategories,
  addCategoryToBusiness,
  searchClientByPhone,
  getClientLocations,
  createOrder,
  getDeliveriesByStatus,
  createClient,
  updateOrder,
  deleteOrder,
  createClientLocation,
  registerOrderConsumption
} from '@/lib/database'
import { isStoreOpen } from '@/lib/store-utils'

// Carga dinámica del componente de historial
const OrderHistory = dynamic(() => import('@/components/OrderHistory'), {
  loading: () => <div className="text-center py-8">Cargando historial...</div>,
  ssr: false
})

const QRCodesContent = dynamic(() => import('@/app/business/qr-codes/qr-codes-content'), {
  loading: () => <div className="text-center py-8 text-gray-400">Cargando herramientas de fidelización...</div>,
  ssr: false
})

export default function BusinessDashboard() {
  const router = useRouter()
  const {
    user,
    businessId,
    ownerId,
    isAuthenticated,
    authLoading,
    logout,
    setBusinessId
  } = useBusinessAuth()
  // Asegurar valores por defecto para usePushNotifications
  const pushNotifications = usePushNotifications()
  const {
    permission = 'default',
    requestPermission = () => Promise.resolve('default'),
    showNotification = (options: { title: string; body: string; icon?: string }) =>
      console.log('Notificación simulada:', options),
    isSupported = false,
    isIOS = false,
    needsUserAction = false
  } = pushNotifications || {}
  const [showCostReports, setShowCostReports] = useState(false)
  const [business, setBusiness] = useState<Business | null>(null)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [historicalOrders, setHistoricalOrders] = useState<Order[]>([])
  const [previousOrdersCount, setPreviousOrdersCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'orders' | 'profile' | 'admins' | 'reports' | 'inventory' | 'qrcodes'>('orders')
  const [profileSubTab, setProfileSubTab] = useState<'general' | 'products' | 'fidelizacion'>('general')
  const [isTiendaMenuOpen, setIsTiendaMenuOpen] = useState(false)
  const [reportsSubTab, setReportsSubTab] = useState<'general' | 'deliveries' | 'costs'>('general')
  const [isReportsMenuOpen, setIsReportsMenuOpen] = useState(false)
  const [showManualOrderModal, setShowManualOrderModal] = useState(false) // Cerrado por defecto
  const [sidebarOpen, setSidebarOpen] = useState(false) // Cerrado por defecto
  const [ordersSubTab, setOrdersSubTab] = useState<'today' | 'history'>('today') // Nueva pestaña para pedidos
  const [historyLoaded, setHistoryLoaded] = useState(false) // Control para carga lazy del historial
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(businessId)
  const [userRole, setUserRole] = useState<'owner' | 'admin' | 'manager' | null>(null) // Nuevo estado
  const [manualSidebarMode, setManualSidebarMode] = useState<'create' | 'edit'>('create')
  const [editingOrderForSidebar, setEditingOrderForSidebar] = useState<Order | null>(null)
  const [showBusinessDropdown, setShowBusinessDropdown] = useState(false)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [editedBusiness, setEditedBusiness] = useState<Business | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingProfile, setUploadingProfile] = useState(false)
  const [uploadingLocation, setUploadingLocation] = useState(false)
  const [businessCategories, setBusinessCategories] = useState<string[]>([])
  const [showAddAdminModal, setShowAddAdminModal] = useState(false)
  const [newAdminData, setNewAdminData] = useState({
    email: '',
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
  const [updatingStoreStatus, setUpdatingStoreStatus] = useState(false)

  // Estados para orden manual
  const [manualOrderData, setManualOrderData] = useState({
    customerPhone: '',
    customerName: '',
    selectedProducts: [] as Array<{
      id: string;
      name: string;
      price: number;
      quantity: number;
      variant?: string;
    }>,
    deliveryType: '' as '' | 'delivery' | 'pickup',
    selectedLocation: null as ClientLocation | null,
    customerLocations: [] as ClientLocation[],
    // Datos de timing
    timingType: 'immediate' as 'immediate' | 'scheduled',
    scheduledDate: '',
    scheduledTime: '',
    // Datos de pago
    paymentMethod: 'cash' as 'cash' | 'transfer' | 'mixed',
    selectedBank: '',
    paymentStatus: 'pending' as 'pending' | 'validating' | 'paid',
    // Pago mixto
    cashAmount: 0,
    transferAmount: 0,
    total: 0,
    // Delivery asignado
    selectedDelivery: null as any
  })
  const [searchingClient, setSearchingClient] = useState(false)
  const [clientFound, setClientFound] = useState(false)
  const [loadingClientLocations, setLoadingClientLocations] = useState(false)
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null)
  const [availableDeliveries, setAvailableDeliveries] = useState<any[]>([])
  const [showCreateClient, setShowCreateClient] = useState(false)
  const [creatingClient, setCreatingClient] = useState(false)

  // Estados para modal de variantes
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null)
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false)

  // Estados para el modal de edición de órdenes
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)

  // Estados para modal de detalles del pedido
  const [showOrderDetailsModal, setShowOrderDetailsModal] = useState(false)
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<Order | null>(null)
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false)
  const [showReceiptPreviewModal, setShowReceiptPreviewModal] = useState(false)
  const [paymentEditingOrder, setPaymentEditingOrder] = useState<Order | null>(null)

  // Asegurar que el estado de edición de pago tenga el tipo correcto
  interface EditPaymentData extends Pick<PaymentInfo, 'method' | 'paymentStatus'> {
    cashAmount: number;
    transferAmount: number;
  }

  const [editPaymentData, setEditPaymentData] = useState<EditPaymentData>({
    method: 'cash' as 'cash' | 'transfer' | 'mixed',
    cashAmount: 0,
    transferAmount: 0,
    paymentStatus: 'pending' as PaymentInfo['paymentStatus']
  })

  // Perf: mark mount (dev-safe, avoids console.time duplicate warnings in StrictMode)
  useEffect(() => {
    const t0 = performance.now()
    console.debug('[Dashboard] initial state', {
      authLoading,
      isAuthenticated,
      hasUser: !!user,
      businessId,
    })
    return () => {
      const dt = performance.now() - t0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Estados para categorías colapsadas en pedidos de hoy
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set(['delivered']))

  // Estado para la orden actualmente expandida (solo una a la vez)
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)

  // Protección de ruta - esperar a que termine la carga de auth y redirigir si no está autenticado
  useEffect(() => {
    const t0 = performance.now()
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace('/business/login');
    }
    const dt = performance.now() - t0
  }, [authLoading, isAuthenticated, router]);

  // Cleanup del timeout al desmontar
  useEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  }, [searchTimeout]);

  // Cargar deliveries activos cuando haya negocio seleccionado
  useEffect(() => {
    if (!business?.id) return;
    (async () => {
      try {
        const deliveries = await getDeliveriesByStatus('activo')
        setAvailableDeliveries(deliveries)
      } catch (e) {
        // Ignorar errores, quedará lista vacía
      }
    })()
  }, [business?.id]);

  useEffect(() => {
    if (typeof window === 'undefined' || !user || !isAuthenticated) return;

    const loadBusinesses = async () => {
      const t0 = performance.now()
      try {
        // Intentar usar caché local para acceso del usuario
        const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
        const cacheKey = `businessAccess:${user.uid}`;
        const cachedRaw = localStorage.getItem(cacheKey);
        let businessAccess: any | null = null;
        let usedCache = false;

        if (cachedRaw) {
          try {
            const cached = JSON.parse(cachedRaw);
            if (cached && cached.timestamp && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
              businessAccess = cached.data;
              usedCache = true;
            }
          } catch { }
        }

        // Si no hay caché válido, o queremos refrescar, hacer fetch
        if (!businessAccess) {
          businessAccess = await getUserBusinessAccess(
            user.email || '',
            user.uid
          );
          // Guardar en caché
          try {
            localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: businessAccess }));
          } catch { }
        } else {
          // Refresco en segundo plano sin bloquear la UI
          (async () => {
            try {
              const fresh = await getUserBusinessAccess(user.email || '', user.uid);
              localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: fresh }));
            } catch { }
          })();
        }

        if (!businessAccess.hasAccess) {
          logout();
          router.push('/business/login');
          return;
        }

        // Combinar tiendas propias y administradas
        const allUserBusinesses = [
          ...businessAccess.ownedBusinesses,
          ...businessAccess.adminBusinesses
        ];

        // Remover duplicados por si acaso
        let uniqueBusinesses = allUserBusinesses.filter((business, index, self) =>
          index === self.findIndex(b => b.id === business.id)
        );

        // Función para obtener el timestamp de una fecha de Firebase
        const getTimestamp = (timestamp: any): number => {
          if (!timestamp) return 0;

          // Si es un objeto de Firestore con toDate()
          if (typeof timestamp.toDate === 'function') {
            return timestamp.toDate().getTime();
          }

          // Si es un objeto de timestamp de Firebase con seconds y nanoseconds
          if (timestamp.seconds) {
            return timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000;
          }

          // Si ya es un timestamp en milisegundos
          if (typeof timestamp === 'number') {
            return timestamp;
          }

          // Si es un string de fecha
          if (typeof timestamp === 'string') {
            return new Date(timestamp).getTime() || 0;
          }

          return 0;
        };

        // Ordenar por fecha de creación (más antigua primero)
        uniqueBusinesses = uniqueBusinesses.sort((a, b) => {
          const timeA = getTimestamp(a.createdAt);
          const timeB = getTimestamp(b.createdAt);
          return timeA - timeB; // Orden ascendente (más antigua primero)
        });

        setBusinesses(uniqueBusinesses);

        // Seleccionar tienda (preferencia: del contexto > primera de la lista ordenada)
        let businessToSelect = null;

        if (businessId) {
          businessToSelect = uniqueBusinesses.find(b => b.id === businessId);
        }

        // Si no hay businessId o no se encontró la tienda, seleccionar la primera de la lista ordenada
        if (!businessToSelect && uniqueBusinesses.length > 0) {
          businessToSelect = uniqueBusinesses[0];
        }

        if (businessToSelect) {
          setSelectedBusinessId(businessToSelect.id);
          setBusiness(businessToSelect);

          // Actualizar el contexto si es diferente
          if (businessToSelect.id !== businessId) {
            setBusinessId(businessToSelect.id);
          }

          // Determinar el rol del usuario en esta tienda
          const isOwner = businessAccess.ownedBusinesses.some((b: any) => b.id === businessToSelect.id);
          if (isOwner) {
            setUserRole('owner');
          } else {
            // Buscar el rol como administrador
            const adminRole = businessToSelect.administrators?.find(
              (admin: any) => admin?.email === user?.email
            );
            setUserRole(adminRole?.role || 'admin');
          }
        }

      } catch (error) {
        router.push('/business/login');
      } finally {
        const dt = performance.now() - t0
        setLoading(false);
      }
    };

    loadBusinesses();
  }, [router, user, businessId, isAuthenticated, logout, setBusinessId]);

  // Cargar datos específicos cuando se selecciona una tienda
  useEffect(() => {
    if (!selectedBusinessId) return;

    const loadBusinessData = async () => {
      const t0 = performance.now()
      try {
        // 1) Leer desde caché para respuesta inmediata (SWR style)
        const CACHE_TTL_MS = 60 * 1000; // 60s
        const pKey = `products:${selectedBusinessId}`
        const cKey = `categories:${selectedBusinessId}`
        const oKey = `orders:${selectedBusinessId}`

        const readCache = (key: string) => {
          const raw = localStorage.getItem(key)
          if (!raw) return null
          try {
            const { timestamp, data } = JSON.parse(raw)
            if (Date.now() - timestamp < CACHE_TTL_MS) return data
          } catch { }
          return null
        }

        const cachedProducts = readCache(pKey)
        const cachedCategories = readCache(cKey)
        const cachedOrders = readCache(oKey)

        if (cachedProducts) setProducts(cachedProducts)
        if (cachedCategories) setBusinessCategories(cachedCategories)
        if (cachedOrders) {
          setOrders(cachedOrders)
          setPreviousOrdersCount(cachedOrders.length)
        }

        // 2) Fetch en paralelo y refrescar estado + cache
        const p0 = performance.now()
        const [productsData, categoriesData, ordersData] = await Promise.all([
          getProductsByBusiness(selectedBusinessId),
          getBusinessCategories(selectedBusinessId),
          getRecentOrdersByBusiness(selectedBusinessId)
        ])

        const pdt = performance.now() - p0
        setProducts(productsData)
        setBusinessCategories(categoriesData)
        try {
          localStorage.setItem(pKey, JSON.stringify({ timestamp: Date.now(), data: productsData }))
          localStorage.setItem(cKey, JSON.stringify({ timestamp: Date.now(), data: categoriesData }))
        } catch { }

        // Detectar nuevos pedidos para notificaciones
        if (previousOrdersCount > 0 && ordersData.length > previousOrdersCount) {
          const newOrders = ordersData.slice(0, ordersData.length - previousOrdersCount);

          // Enviar notificación por cada nuevo pedido
          newOrders.forEach((order: Order) => {
            if (permission === 'granted') {
              // Construir título y descripción personalizados

              const businessName = business?.name || 'Tu Tienda';
              const orderType = order.timing?.type === 'immediate' ? 'Pedido Inmediato' : 'Pedido Programado';
              const title = `${businessName} - ${orderType}`;

              // Construir descripción con elementos del carrito
              const items = order.items || [];
              let itemsText = '';

              if (items.length === 1) {
                // Un solo elemento: mostrar nombre específico del producto
                const item = items[0];
                itemsText = item.product?.name || 'Producto';
              } else if (items.length > 1) {
                // Múltiples elementos: mostrar el primero + "y X más"
                const firstItem = items[0];
                const firstName = firstItem.product?.name || 'Producto';
                itemsText = `${firstName} y ${items.length - 1} más`;
              } else {
                itemsText = 'Sin productos';
              }

              const deliveryType = order.delivery?.type === 'delivery' ? 'Delivery' : 'Retiro';
              const body = `${itemsText} - ${deliveryType} - $${order.total.toFixed(2)}`;

              showNotification({
                title,
                body,
                url: '/business/dashboard',
                orderId: order.id
              });
            }
          });
        }

        setOrders(ordersData);
        setPreviousOrdersCount(ordersData.length);

        try {
          localStorage.setItem(oKey, JSON.stringify({ timestamp: Date.now(), data: ordersData }))
        } catch { }

        // Actualizar localStorage
        localStorage.setItem('businessId', selectedBusinessId);
      } catch (error) {
        // Error loading business data
      } finally {
        const dt = performance.now() - t0
      }
    };

    loadBusinessData();
  }, [selectedBusinessId]);

  // Manejar navegación profunda desde URL (tab y subtab)
  useEffect(() => {
    if (loading || !selectedBusinessId) return;

    const query = new URLSearchParams(window.location.search);
    const tab = query.get('tab');
    const subtab = query.get('subtab');

    if (tab && ['orders', 'profile', 'admins', 'reports', 'inventory', 'qrcodes'].includes(tab)) {
      setActiveTab(tab as any);
      if (tab === 'profile') {
        setIsTiendaMenuOpen(true);
        if (subtab && ['general', 'products', 'fidelizacion'].includes(subtab)) {
          setProfileSubTab(subtab as any);
        }
      }
      if (tab === 'reports') {
        setIsReportsMenuOpen(true);
        if (subtab && ['general', 'deliveries', 'costs'].includes(subtab)) {
          setReportsSubTab(subtab as any);
        }
      }
    }
  }, [loading, selectedBusinessId]);

  // Función para recargar solo las órdenes
  const loadOrders = async () => {
    if (!selectedBusinessId) return;
    try {
      const ordersData = await getRecentOrdersByBusiness(selectedBusinessId);
      setOrders(ordersData);
      setPreviousOrdersCount(ordersData.length);

    } catch (error) {
      console.error('Error loading orders:', error);
    }
  };

  // Cargar deliveries activos
  useEffect(() => {
    // No intentar cargar deliveries hasta que el usuario esté autenticado
    if (!isAuthenticated) return

    const loadDeliveries = async () => {
      const t0 = performance.now()
      try {
        const deliveries = await getDeliveriesByStatus('activo')
        setAvailableDeliveries(deliveries)
      } catch (error) {
        // Error loading deliveries (getDeliveriesByStatus ya devuelve [] en caso de fallo)
      } finally {
        const dt = performance.now() - t0
      }
    }

    loadDeliveries()
  }, [])

  // Efecto para recargar pedidos periódicamente y detectar nuevos
  useEffect(() => {
    if (!selectedBusinessId) return

    const interval = setInterval(async () => {
      try {
        const ordersData = await getRecentOrdersByBusiness(selectedBusinessId);

        // Detectar nuevos pedidos
        if (previousOrdersCount > 0 && ordersData.length > previousOrdersCount) {
          const newOrders = ordersData.slice(0, ordersData.length - previousOrdersCount);

          // Enviar notificación por cada nuevo pedido
          newOrders.forEach((order: Order) => {
            if (permission === 'granted') {
              // Construir título y descripción personalizados
              const businessName = business?.name || 'Tu Tienda';
              const orderType = order.timing?.type === 'immediate' ? 'Pedido Inmediato' : 'Pedido Programado';
              const title = `${businessName} - ${orderType}`;

              // Construir descripción con elementos del carrito
              const items = order.items || [];
              let itemsText = '';

              if (items.length === 1) {
                // Un solo elemento: mostrar nombre específico del producto
                const item = items[0];
                itemsText = item.product?.name || 'Producto';
              } else if (items.length > 1) {
                // Múltiples elementos: mostrar el primero + "y X más"
                const firstItem = items[0];
                const firstName = firstItem.product?.name || 'Producto';
                itemsText = `${firstName} y ${items.length - 1} más`;
              } else {
                itemsText = 'Sin productos';
              }

              const deliveryType = order.delivery?.type === 'delivery' ? 'Delivery' : 'Retiro';
              const body = `${itemsText} - ${deliveryType} - $${order.total.toFixed(2)}`;

              showNotification({
                title,
                body,
                url: '/business/dashboard',
                orderId: order.id
              });
            }
          });
        }

        setOrders(ordersData);
        setPreviousOrdersCount(ordersData.length);
      } catch (error) {
        console.error('Error recargando pedidos:', error);
      }
    }, 30000); // Recargar cada 30 segundos

    return () => clearInterval(interval);
  }, [selectedBusinessId, previousOrdersCount, permission, showNotification])

  // Efecto para cargar automáticamente el historial cuando el usuario entra a la pestaña
  useEffect(() => {
    const loadHistoryIfNeeded = async () => {
      if (ordersSubTab === 'history' && !historyLoaded && selectedBusinessId) {
        try {
          const historyData = await getHistoricalOrdersByBusiness(selectedBusinessId)
          setHistoricalOrders(historyData)
          setHistoryLoaded(true)
        } catch (error) {
          console.error('Error loading historical orders:', error)
        }
      }
    }

    loadHistoryIfNeeded()
  }, [ordersSubTab, historyLoaded, selectedBusinessId])

  // Efecto para calcular automáticamente el total del pedido manual
  useEffect(() => {
    const subtotal = manualOrderData.selectedProducts.reduce((sum, item) =>
      sum + (item.price * item.quantity), 0
    );
    const delivery = manualOrderData.deliveryType === 'delivery' && manualOrderData.selectedLocation
      ? parseFloat(manualOrderData.selectedLocation.tarifa || '0')
      : 0;
    const newTotal = subtotal + delivery;

    // Solo actualizar si el total cambió
    if (Math.abs(manualOrderData.total - newTotal) > 0.01) {
      setManualOrderData(prev => ({
        ...prev,
        total: newTotal,
        // Si es pago mixto y algún valor está en 0, distribuir automáticamente
        ...(prev.paymentMethod === 'mixed' && (prev.cashAmount === 0 && prev.transferAmount === 0) && {
          cashAmount: newTotal / 2,
          transferAmount: newTotal / 2
        })
      }));
    }
  }, [manualOrderData.selectedProducts, manualOrderData.deliveryType, manualOrderData.selectedLocation]);

  const handleBusinessChange = (businessId: string) => {
    const selectedBusiness = businesses.find(b => b.id === businessId);
    if (selectedBusiness) {
      setSelectedBusinessId(businessId);
      setBusiness(selectedBusiness);

      // Actualizar el contexto
      setBusinessId(businessId);

      // Actualizar el rol del usuario en la nueva tienda
      const isOwner = user && selectedBusiness.ownerId === user.uid;
      if (isOwner) {
        setUserRole('owner');
      } else {
        const adminRole = selectedBusiness.administrators?.find(
          admin => admin.email === user?.email
        );
        setUserRole(adminRole?.role || 'admin');
      }
    }
  };

  const handleStatusChange = async (orderId: string, newStatus: Order['status']) => {
    try {
      await updateOrderStatus(orderId, newStatus)
      // Actualizar estado local
      setOrders(orders.map(order =>
        order.id === orderId ? { ...order, status: newStatus } : order
      ))
    } catch (error) {
      // Error updating order status
    }
  }

  // Avanzar estado al siguiente en la cadena lógica
  const getNextStatus = (status: Order['status']): Order['status'] | null => {
    const flow: Order['status'][] = ['pending', 'confirmed', 'preparing', 'ready', 'delivered']
    const idx = flow.indexOf(status)
    if (idx === -1) return null
    if (idx >= flow.length - 1) return null
    return flow[idx + 1]
  }

  const handleAdvanceStatus = async (order: Order) => {
    const next = getNextStatus(order.status)
    if (!next) return
    await handleStatusChange(order.id, next)
  }

  const handleDeliveryAssignment = async (orderId: string, deliveryId: string) => {
    try {
      // Actualizar la orden con el delivery asignado
      const orderRef = doc(db, 'orders', orderId)
      await updateDoc(orderRef, {
        'delivery.assignedDelivery': deliveryId || null
      })

      // Actualizar estado local
      setOrders(orders.map(order =>
        order.id === orderId ? {
          ...order,
          delivery: {
            ...order.delivery,
            assignedDelivery: deliveryId || undefined
          }
        } : order
      ))
    } catch (error) {
      // Error updating delivery assignment
    }
  }

  // Funciones para editar órdenes
  const handleEditOrder = (order: Order) => {
    // Abrir el sidebar en modo edición
    setManualSidebarMode('edit')
    setEditingOrderForSidebar(order)
    setShowManualOrderModal(true)
  }

  const handleDeleteOrder = async (orderId: string) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar esta orden? Esta acción no se puede deshacer.')) {
      return
    }

    try {
      await deleteOrder(orderId)

      // Actualizar estado local
      setOrders(orders.filter(order => order.id !== orderId))

      alert('Orden eliminada correctamente')
    } catch (error) {
      alert('Error al eliminar la orden')
    }
  }

  // Nuevas funciones para las implementaciones solicitadas
  const handleShowOrderDetails = (order: Order) => {
    setSelectedOrderDetails(order)
    setShowOrderDetailsModal(true)
  }

  const handleEditPayment = (order: Order) => {
    setPaymentEditingOrder(order)
    setEditPaymentData({
      method: order.payment?.method || 'cash',
      cashAmount: (order.payment as any)?.cashAmount || 0,
      transferAmount: (order.payment as any)?.transferAmount || 0,
      paymentStatus: order.payment?.paymentStatus || (order.payment?.method === 'transfer' ? 'paid' : 'pending')
    })
    setShowEditPaymentModal(true)
  }

  const handleSavePaymentEdit = async () => {
    if (!paymentEditingOrder) return

    try {
      let paymentUpdate: any = {
        method: editPaymentData.method,
        paymentStatus: editPaymentData.paymentStatus || 'pending'
      }

      if (editPaymentData.method === 'mixed') {
        paymentUpdate.cashAmount = editPaymentData.cashAmount
        paymentUpdate.transferAmount = editPaymentData.transferAmount
      }

      await updateOrder(paymentEditingOrder.id, {
        payment: {
          ...paymentEditingOrder.payment,
          ...paymentUpdate
        }
      })

      // Actualizar la lista local
      setOrders(orders.map(order =>
        order.id === paymentEditingOrder.id
          ? { ...order, payment: { ...order.payment, ...paymentUpdate } }
          : order
      ))

      setShowEditPaymentModal(false)
      setPaymentEditingOrder(null)
    } catch (error) {
      console.error('Error updating payment:', error)
    }
  }

  const handleMarkAsDelivered = async (orderId: string) => {
    if (!window.confirm('¿Marcar este pedido como entregado?')) {
      return
    }
    await handleStatusChange(orderId, 'delivered')
  }

  const handleMarkGroupAsDelivered = async (status: string, ordersToUpdate: Order[]) => {
    const statusName = getStatusDisplayName(status);
    if (!window.confirm(`¿Marcar todos los pedidos en "${statusName}" como entregados (${ordersToUpdate.length} pedidos)?`)) {
      return
    }

    try {
      // Usar Promise.all para actualizar todos en paralelo
      await Promise.all(ordersToUpdate.map(order => updateOrderStatus(order.id, 'delivered' as const)));

      // Actualizar estado local de una sola vez
      const updatedOrderIds = new Set(ordersToUpdate.map(o => o.id));
      setOrders(prevOrders => prevOrders.map(order =>
        updatedOrderIds.has(order.id) ? { ...order, status: 'delivered' as const } : order
      ));

      alert(`Se marcaron ${ordersToUpdate.length} pedidos como entregados.`);
    } catch (error) {
      console.error('Error marking group as delivered:', error);
      alert('Hubo un error al actualizar algunos pedidos.');
    }
  }

  const handleMarkAsPaid = async (orderId: string) => {
    if (!window.confirm('¿Marcar este pedido como pagado por transferencia?')) {
      return
    }

    try {
      const orderRef = doc(db, 'orders', orderId)
      await updateDoc(orderRef, {
        'payment.paymentStatus': 'paid'
      })

      // Actualizar estado local
      setOrders(orders.map(order =>
        order.id === orderId ? {
          ...order,
          payment: {
            ...order.payment!,
            paymentStatus: 'paid'
          }
        } : order
      ))
    } catch (error) {
      alert('Error al actualizar el estado de pago')
    }
  }

  const handleValidatePayment = async (orderId: string) => {
    try {
      if (!paymentEditingOrder) return

      let paymentUpdate: any = {
        method: editPaymentData.method,
        paymentStatus: 'paid' as const
      }

      if (editPaymentData.method === 'mixed') {
        paymentUpdate.cashAmount = editPaymentData.cashAmount
        paymentUpdate.transferAmount = editPaymentData.transferAmount
      }

      const updatedPayment = {
        ...paymentEditingOrder.payment,
        ...paymentUpdate
      }

      await updateOrder(orderId, {
        payment: updatedPayment
      })

      // Actualizar estado local
      setOrders(orders.map(order =>
        order.id === orderId
          ? { ...order, payment: updatedPayment }
          : order
      ))

      setShowReceiptPreviewModal(false)
      setShowEditPaymentModal(false)
      setPaymentEditingOrder(null)
    } catch (error) {
      console.error('Error validating payment:', error)
      alert('Error al validar el pago')
    }
  }

  const handleRejectPayment = async (orderId: string) => {
    try {
      const orderRef = doc(db, 'orders', orderId)
      await updateDoc(orderRef, {
        'payment.paymentStatus': 'rejected' as const
      })

      // Actualizar estado local
      const updatedOrders = orders.map(order =>
        order.id === orderId ? {
          ...order,
          payment: {
            ...order.payment!,
            paymentStatus: 'rejected' as const
          }
        } : order
      );
      setOrders(updatedOrders);

      // Si el pedido es el que se está editando, actualizar también ese estado
      if (paymentEditingOrder?.id === orderId) {
        setPaymentEditingOrder({
          ...paymentEditingOrder,
          payment: {
            ...paymentEditingOrder.payment!,
            paymentStatus: 'rejected' as const
          }
        });
        setEditPaymentData(prev => ({
          ...prev,
          paymentStatus: 'rejected' as const
        }));
      }

      setShowReceiptPreviewModal(false);
    } catch (error) {
      alert('Error al rechazar el pago');
    }
  }

  const toggleCategoryCollapse = (category: string) => {
    const newCollapsed = new Set(collapsedCategories)
    if (newCollapsed.has(category)) {
      newCollapsed.delete(category)
    } else {
      newCollapsed.add(category)
    }
    setCollapsedCategories(newCollapsed)
  }

  // Wrappers para usar funciones de WhatsAppUtils
  const handleSendWhatsApp = async (order: Order) => {
    const updateLocalOrder = (updatedOrder: Order) => {
      setOrders(prevOrders =>
        prevOrders.map(o => o.id === updatedOrder.id ? updatedOrder : o)
      );
    };

    // Actualizar waSentToDelivery en la base de datos
    try {
      await updateOrder(order.id, { waSentToDelivery: true });
      // Actualizar localmente antes de llamar a sendWhatsAppToDelivery para que la UI responda rápido
      updateLocalOrder({ ...order, waSentToDelivery: true });
    } catch (error) {
      console.error('Error updating waSentToDelivery:', error);
    }

    await sendWhatsAppToDelivery(
      { ...order, waSentToDelivery: true }, // Pasar la orden actualizada
      availableDeliveries,
      business,
      handleStatusChange,
      updateLocalOrder
    );
  };

  const handleSendWhatsAppAndAdvance = async (order: Order) => {
    await handleSendWhatsApp(order);
  };

  const handleSendWhatsAppToCustomer = (order: Order) => {
    sendWhatsAppToCustomer(order);
  };

  // Manejo de nuevas órdenes creadas por clientes
  const handleNewOrder = (newOrder: Order) => {
    // Recargar órdenes para que aparezca en el dashboard
    loadOrders()
  };



  // Función para subir imagen de portada
  const handleCoverImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !business) return;

    setUploadingCover(true);
    try {
      // Subir imagen a Firebase Storage
      const timestamp = Date.now();
      const path = `businesses/covers/${business.id}_${timestamp}_${file.name}`;
      const imageUrl = await uploadImage(file, path);

      // Actualizar el negocio en Firebase
      await updateBusiness(business.id, { coverImage: imageUrl });

      // Actualizar estado local
      const updatedBusiness = { ...business, coverImage: imageUrl };
      setBusiness(updatedBusiness);

      // Si se está editando, actualizar también el estado de edición
      if (editedBusiness && editedBusiness.id === business.id) {
        setEditedBusiness({ ...editedBusiness, coverImage: imageUrl });
      }

      // Actualizar en la lista de negocios
      setBusinesses(prev => prev.map(b =>
        b.id === business.id ? updatedBusiness : b
      ));

      updateBusinessCache(updatedBusiness);

    } catch (error) {
      alert('Error al subir la imagen de portada. Inténtalo de nuevo.');
    } finally {
      setUploadingCover(false);
    }
  };

  // Función para subir imagen de perfil
  const handleProfileImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !business) return;

    setUploadingProfile(true);
    try {
      // Subir imagen a Firebase Storage
      const timestamp = Date.now();
      const path = `businesses/profiles/${business.id}_${timestamp}_${file.name}`;
      const imageUrl = await uploadImage(file, path);

      // Actualizar el negocio en Firebase
      await updateBusiness(business.id, { image: imageUrl });

      // Actualizar estado local
      const updatedBusiness = { ...business, image: imageUrl };
      setBusiness(updatedBusiness);

      // Si se está editando, actualizar también el estado de edición
      if (editedBusiness && editedBusiness.id === business.id) {
        setEditedBusiness({ ...editedBusiness, image: imageUrl });
      }

      // Actualizar en la lista de negocios
      setBusinesses(prev => prev.map(b =>
        b.id === business.id ? updatedBusiness : b
      ));

      updateBusinessCache(updatedBusiness);

    } catch (error) {
      alert('Error al subir la imagen de perfil. Inténtalo de nuevo.');
    } finally {
      setUploadingProfile(false);
    }
  };

  // Función para subir foto del local
  const handleLocationImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !business) return;

    setUploadingLocation(true);
    try {
      // Subir imagen a Firebase Storage
      const timestamp = Date.now();
      const path = `businesses/locations/${business.id}_${timestamp}_${file.name}`;
      const imageUrl = await uploadImage(file, path);

      // Actualizar el negocio en Firebase
      await updateBusiness(business.id, { locationImage: imageUrl });

      // Actualizar estado local
      const updatedBusiness = { ...business, locationImage: imageUrl };
      setBusiness(updatedBusiness);

      // Si se está editando, actualizar también el estado de edición
      if (editedBusiness && editedBusiness.id === business.id) {
        setEditedBusiness({ ...editedBusiness, locationImage: imageUrl });
      }

      // Actualizar en la lista de negocios
      setBusinesses(prev => prev.map(b =>
        b.id === business.id ? updatedBusiness : b
      ));

      updateBusinessCache(updatedBusiness);

    } catch (error) {
      alert('Error al subir la foto del local. Inténtalo de nuevo.');
    } finally {
      setUploadingLocation(false);
    }
  };

  // Función para iniciar edición
  const handleEditProfile = () => {
    setIsEditingProfile(true);
    setEditedBusiness(business ? { ...business } : null);
  };

  // Función para cancelar edición
  const handleCancelEdit = () => {
    setIsEditingProfile(false);
    setEditedBusiness(null);
  };

  // Función para guardar cambios
  const handleSaveProfile = async () => {
    if (!editedBusiness) return;

    try {
      // Actualizar en Firebase
      await updateBusiness(editedBusiness.id, editedBusiness);

      // Actualizar estados locales
      setBusiness(editedBusiness);
      setBusinesses(prev => prev.map(b =>
        b.id === editedBusiness.id ? editedBusiness : b
      ));

      updateBusinessCache(editedBusiness);

      setIsEditingProfile(false);
      setEditedBusiness(null);

      alert('Información actualizada exitosamente');
    } catch (error) {
      alert('Error al guardar los cambios. Inténtalo de nuevo.');
    }
  };

  // Función para actualizar campo del negocio editado
  const handleBusinessFieldChange = (field: keyof Business, value: any) => {
    if (!editedBusiness) return;
    setEditedBusiness({ ...editedBusiness, [field]: value });
  };

  // Funciones para editar el horario (schedule)
  const handleScheduleFieldChange = (day: string, key: 'open' | 'close' | 'isOpen', value: any) => {
    if (!editedBusiness) return;
    const schedule = editedBusiness.schedule ? { ...editedBusiness.schedule } : {} as any;
    const dayObj = schedule[day] ? { ...schedule[day] } : { open: '09:00', close: '18:00', isOpen: true };
    dayObj[key] = value;
    schedule[day] = dayObj;
    setEditedBusiness({ ...editedBusiness, schedule });
  };

  const toggleDayOpen = (day: string) => {
    if (!editedBusiness) return;
    const schedule = editedBusiness.schedule ? { ...editedBusiness.schedule } : {} as any;
    const dayObj = schedule[day] ? { ...schedule[day] } : { open: '09:00', close: '18:00', isOpen: true };
    dayObj.isOpen = !dayObj.isOpen;
    schedule[day] = dayObj;
    setEditedBusiness({ ...editedBusiness, schedule });
  };

  // Funciones para administradores
  const handleAddAdmin = async () => {
    if (!business || !newAdminData.email.trim()) return;

    setAddingAdmin(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Usuario no autenticado');

      await addBusinessAdministrator(
        business.id,
        newAdminData.email,
        newAdminData.role,
        newAdminData.permissions,
        currentUser.uid
      );

      // Recargar datos del negocio para mostrar el nuevo admin
      const updatedBusiness = await getBusiness(business.id);
      if (updatedBusiness) {
        setBusiness(updatedBusiness);
        setBusinesses(prev => prev.map(b =>
          b.id === business.id ? updatedBusiness : b
        ));
      }

      // Resetear formulario y cerrar modal
      setNewAdminData({
        email: '',
        role: 'admin',
        permissions: {
          manageProducts: true,
          manageOrders: true,
          manageAdmins: false,
          viewReports: true,
          editBusiness: false
        }
      });
      setShowAddAdminModal(false);
      alert('Administrador agregado exitosamente');
    } catch (error: any) {
      alert(error.message || 'Error al agregar administrador');
    } finally {
      setAddingAdmin(false);
    }
  };

  const handleRemoveAdmin = async (adminEmail: string) => {
    if (!business || !confirm('¿Estás seguro de que quieres remover este administrador?')) return;

    try {
      await removeBusinessAdministrator(business.id, adminEmail);

      // Recargar datos del negocio
      const updatedBusiness = await getBusiness(business.id);
      if (updatedBusiness) {
        setBusiness(updatedBusiness);
        setBusinesses(prev => prev.map(b =>
          b.id === business.id ? updatedBusiness : b
        ));
      }

      alert('Administrador removido exitosamente');
    } catch (error: any) {
      alert(error.message || 'Error al remover administrador');
    }
  };

  const handleUpdateAdminPermissions = async (adminEmail: string, newPermissions: any) => {
    if (!business) return;

    try {
      await updateAdministratorPermissions(business.id, adminEmail, newPermissions);

      // Recargar datos del negocio
      const updatedBusiness = await getBusiness(business.id);
      if (updatedBusiness) {
        setBusiness(updatedBusiness);
        setBusinesses(prev => prev.map(b =>
          b.id === business.id ? updatedBusiness : b
        ));
      }

      alert('Permisos actualizados exitosamente');
    } catch (error: any) {
      alert(error.message || 'Error al actualizar permisos');
    }
  };

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (showBusinessDropdown && !target.closest('.business-dropdown-container')) {
        setShowBusinessDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showBusinessDropdown]);

  const handleLogout = () => {
    logout()
    router.push('/business/login')
  }

  // Función para toggle manual de estado de tienda
  const handleToggleStoreStatus = async () => {
    if (!business?.id) return

    setUpdatingStoreStatus(true)
    try {
      const currentStatus = business.manualStoreStatus
      let newStatus: 'open' | 'closed' | null

      // Ciclo: null (Auto) -> closed (Forzar Cerrado) -> open (Forzar Abierto) -> null
      if (currentStatus === null || currentStatus === undefined) {
        newStatus = 'closed'
      } else if (currentStatus === 'closed') {
        newStatus = 'open'
      } else {
        newStatus = null
      }

      await updateBusiness(business.id, { manualStoreStatus: newStatus })

      // Actualizar estado local
      const updatedBusiness = { ...business, manualStoreStatus: newStatus }
      setBusiness(updatedBusiness)
      setBusinesses(prev => prev.map(b =>
        b.id === business.id ? updatedBusiness : b
      ))

      // Actualizar también el caché para que persista al recargar
      updateBusinessCache(updatedBusiness)
    } catch (error) {
      console.error('Error updating store status:', error)
      alert('Error al actualizar el estado de la tienda')
    } finally {
      setUpdatingStoreStatus(false)
    }
  }

  // Función helper para actualizar el cache de localStorage
  const updateBusinessCache = (updatedBusiness: Business) => {
    if (!user?.uid) return;

    const cacheKey = `businessAccess:${user.uid}`;
    const cachedRaw = localStorage.getItem(cacheKey);

    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        if (cached && cached.data) {
          const data = cached.data;

          // Actualizar en ownedBusinesses
          if (data.ownedBusinesses) {
            data.ownedBusinesses = data.ownedBusinesses.map((b: Business) =>
              b.id === updatedBusiness.id ? updatedBusiness : b
            );
          }

          // Actualizar en adminBusinesses
          if (data.adminBusinesses) {
            data.adminBusinesses = data.adminBusinesses.map((b: Business) =>
              b.id === updatedBusiness.id ? updatedBusiness : b
            );
          }

          // Guardar de nuevo en localStorage
          localStorage.setItem(cacheKey, JSON.stringify(cached));
        }
      } catch (e) {
        console.error('Error updating cache:', e);
      }
    }
  };

  // Función helper para obtener la fecha actual en zona horaria de Ecuador (UTC-5)
  const getEcuadorDate = (date?: Date) => {
    const targetDate = date || new Date();
    const ecuadorOffset = -5 * 60; // UTC-5 en minutos
    return new Date(targetDate.getTime() + (ecuadorOffset + targetDate.getTimezoneOffset()) * 60000);
  };

  // Función helper para formatear fecha para input date en zona horaria de Ecuador
  const formatDateForInput = (date?: Date) => {
    if (!date) {
      const ecuadorDate = getEcuadorDate();
      return ecuadorDate.toISOString().split('T')[0];
    }

    // Para fechas que vienen de Firebase o que ya están en la zona horaria correcta,
    // usar directamente los componentes de fecha sin conversión adicional
    // Esto evita el problema de doble conversión de zona horaria
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Función para categorizar pedidos
  const categorizeOrders = () => {
    const now = getEcuadorDate();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayOrders = orders.filter(order => {
      const orderDate = getOrderDateTime(order);
      return orderDate >= today && orderDate < tomorrow;
    }).sort((a, b) => {
      const timeA = getOrderDateTime(a).getTime();
      const timeB = getOrderDateTime(b).getTime();
      return timeA - timeB;
    });

    const upcomingOrders = orders.filter(order => {
      const orderDate = getOrderDateTime(order);
      return orderDate >= tomorrow;
    }).sort((a, b) => {
      const timeA = getOrderDateTime(a).getTime();
      const timeB = getOrderDateTime(b).getTime();
      return timeA - timeB;
    });

    const pastOrders = orders.filter(order => {
      const orderDate = getOrderDateTime(order);
      return orderDate < today;
    }).sort((a, b) => {
      const timeA = getOrderDateTime(a).getTime();
      const timeB = getOrderDateTime(b).getTime();
      return timeB - timeA;
    });

    return { todayOrders, upcomingOrders, pastOrders };
  };

  // Función para agrupar pedidos por fecha
  const groupOrdersByDate = (orders: Order[]) => {
    const grouped = orders.reduce((acc, order) => {
      const orderDate = getOrderDateTime(order)
      const dateKey = orderDate.toLocaleDateString('es-EC', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })

      if (!acc[dateKey]) {
        acc[dateKey] = []
      }
      acc[dateKey].push(order)
      return acc
    }, {} as Record<string, Order[]>)

    // Convertir a array y ordenar por fecha (más reciente primero)
    return Object.entries(grouped)
      .sort(([dateA], [dateB]) => {
        const orderA = grouped[dateA][0]
        const orderB = grouped[dateB][0]
        return getOrderDateTime(orderB).getTime() - getOrderDateTime(orderA).getTime()
      })
      .map(([date, orders]) => ({
        date,
        orders: orders.sort((a, b) => getOrderDateTime(b).getTime() - getOrderDateTime(a).getTime())
      }))
  }

  // Función auxiliar para categorizar pedidos (para usar en useEffect)
  const categorizeOrdersForData = (ordersData: Order[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayOrders = ordersData.filter(order => {
      const orderDate = getOrderDateTime(order);
      return orderDate >= today && orderDate < tomorrow;
    }).sort((a, b) => {
      const timeA = getOrderDateTime(a).getTime();
      const timeB = getOrderDateTime(b).getTime();
      return timeA - timeB;
    });

    const upcomingOrders = ordersData.filter(order => {
      const orderDate = getOrderDateTime(order);
      return orderDate >= tomorrow;
    }).sort((a, b) => {
      const timeA = getOrderDateTime(a).getTime();
      const timeB = getOrderDateTime(b).getTime();
      return timeA - timeB;
    });

    const pastOrders = ordersData.filter(order => {
      const orderDate = getOrderDateTime(order);
      return orderDate < today;
    }).sort((a, b) => {
      const timeA = getOrderDateTime(a).getTime();
      const timeB = getOrderDateTime(b).getTime();
      return timeB - timeA;
    });

    return { todayOrders, upcomingOrders, pastOrders };
  }

  const formatTime = (dateValue: string | Date) => {
    try {
      const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
      if (isNaN(date.getTime())) {
        return 'Hora inválida';
      }
      return date.toLocaleTimeString('es-EC', {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      console.warn('Error formatting time:', error);
      return 'Hora inválida';
    }
  };

  const formatDate = (dateValue: string | Date) => {
    try {
      const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
      if (isNaN(date.getTime())) {
        return 'Fecha inválida';
      }
      return date.toLocaleDateString('es-EC', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch (error) {
      console.warn('Error formatting date:', error);
      return 'Fecha inválida';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'preparing': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'ready': return 'bg-green-100 text-green-800 border-green-200';
      case 'completed': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'delivered': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'cancelled': return 'bg-red-100 text-red-800 border-red-200';
      case 'pending': return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'confirmed': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'preparing': return 'Preparando';
      case 'ready': return 'Listo';
      case 'completed': return 'Completado';
      case 'delivered': return 'Entregado';
      case 'cancelled': return 'Cancelado';
      case 'pending': return 'Pendiente';
      case 'confirmed': return 'Confirmado';
      default: return status;
    }
  };

  // Función helper para obtener la fecha/hora de una orden
  const getOrderDateTime = (order: Order) => {
    try {
      // Si tiene timing con scheduledDate y scheduledTime, usar esos
      if (order.timing?.scheduledDate && order.timing?.scheduledTime) {
        // Manejar diferentes tipos de scheduledDate
        let dateToUse: Date;

        if (order.timing.scheduledDate instanceof Date) {
          // Es un objeto Date
          dateToUse = order.timing.scheduledDate;
        } else if (order.timing.scheduledDate && typeof order.timing.scheduledDate === 'object') {
          // Verificar si es un Timestamp de Firebase (con seconds y nanoseconds)
          const timestampObj = order.timing.scheduledDate as any;
          if (typeof timestampObj.seconds === 'number' && typeof timestampObj.nanoseconds === 'number') {
            // Convertir manualmente usando seconds y nanoseconds
            const milliseconds = timestampObj.seconds * 1000 + Math.floor(timestampObj.nanoseconds / 1000000);
            dateToUse = new Date(milliseconds);
          } else if ('toDate' in timestampObj && typeof timestampObj.toDate === 'function') {
            dateToUse = timestampObj.toDate();
          } else {
            dateToUse = new Date(timestampObj);
          }
        } else if (typeof order.timing.scheduledDate === 'string') {
          // Es un string
          dateToUse = new Date(order.timing.scheduledDate);
        } else {
          // Fallback: intentar convertir a Date
          dateToUse = new Date(order.timing.scheduledDate as any);
        }

        // Verificar que la fecha sea válida
        if (isNaN(dateToUse.getTime())) {
          console.error('Invalid date after conversion for order:', order.id, dateToUse);
          throw new Error('Invalid date after conversion');
        }

        // Parsear la hora del scheduledTime
        const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number);

        // Verificar que los valores de hora sean válidos
        if (isNaN(hours) || isNaN(minutes)) {
          console.error('Invalid time components for order:', order.id, order.timing.scheduledTime);
          throw new Error('Invalid time components');
        }

        // El scheduledDate ya contiene la fecha y hora correctas, solo necesitamos validar
        return dateToUse;
      }
      // Si tiene solo scheduledTime (formato anterior), usar createdAt para la fecha
      else if (order.timing?.scheduledTime) {
        const createdDate = new Date(order.createdAt);
        if (isNaN(createdDate.getTime())) {
          throw new Error('Invalid createdAt date');
        }

        const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number);
        if (isNaN(hours) || isNaN(minutes)) {
          throw new Error('Invalid time format');
        }

        const orderDate = new Date(createdDate);
        orderDate.setHours(hours, minutes, 0, 0);
        return orderDate;
      }
      // Fallback a createdAt
      else {
        const fallbackDate = new Date(order.createdAt);
        if (isNaN(fallbackDate.getTime())) {
          // Si createdAt también es inválido, intentar usar cualquier fecha disponible
          console.error('Invalid createdAt for order:', order.id, order.createdAt);
          // Como último recurso, usar la fecha actual pero log el error
          const currentDate = new Date();
          console.warn('Using current date as fallback for order:', order.id);
          return currentDate;
        }
        return fallbackDate;
      }
    } catch (error) {
      console.error('Error parsing order date for order:', order.id, error, {
        timing: order.timing,
        createdAt: order.createdAt
      });
      // En caso de cualquier error, usar la fecha de creación como fallback más seguro
      try {
        const createdAtFallback = new Date(order.createdAt);
        if (!isNaN(createdAtFallback.getTime())) {
          return createdAtFallback;
        }
      } catch (e) {
        console.error('Even createdAt failed for order:', order.id);
      }
      // Como último último recurso
      return new Date();
    }
  };

  const getStatusDisplayName = (status: string) => {
    switch (status) {
      case 'preparing': return 'Preparando';
      case 'ready': return 'Listos';
      case 'completed': return 'Completados';
      case 'delivered': return 'Entregados';
      case 'cancelled': return 'Cancelados';
      case 'pending': return 'Pendientes';
      case 'confirmed': return 'Confirmados';
      default: return status;
    }
  };

  // Función para determinar si una orden está próxima (dentro de 30 minutos)
  const isOrderUpcoming = (order: Order) => {
    const orderTime = getOrderDateTime(order);
    const now = new Date();
    const diffInMinutes = (orderTime.getTime() - now.getTime()) / (1000 * 60);

    // Está dentro de los próximos 30 minutos
    return diffInMinutes <= 30 && diffInMinutes >= 0;
  };

  // Función para agrupar y ordenar pedidos por estado
  const groupOrdersByStatus = (orders: Order[]) => {
    const statusOrder = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'];

    return orders.sort((a, b) => {
      const aIndex = statusOrder.indexOf(a.status);
      const bIndex = statusOrder.indexOf(b.status);

      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }

      // Si tienen el mismo estado, ordenar por hora
      const timeA = getOrderDateTime(a).getTime();
      const timeB = getOrderDateTime(b).getTime();

      return timeA - timeB;
    });
  };

  // Función para agrupar órdenes por estado para mostrar títulos
  const groupOrdersWithTitles = (orders: Order[]) => {
    const grouped: { [status: string]: Order[] } = {};
    const statusOrder = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'];

    orders.forEach(order => {
      if (!grouped[order.status]) {
        grouped[order.status] = [];
      }
      grouped[order.status].push(order);
    });

    return statusOrder.filter(status => grouped[status]?.length > 0).map(status => ({
      status,
      orders: grouped[status]
    }));
  };

  // Componente de tabla para pedidos
  const OrdersTable = ({ orders, isToday = false }: { orders: Order[], isToday?: boolean }) => {
    if (isToday) {
      const groupedOrders = groupOrdersWithTitles(groupOrdersByStatus(orders));

      return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-0">
              <tbody className="bg-white">
                {groupedOrders.map(({ status, orders: statusOrders }, groupIndex) => (
                  <React.Fragment key={`group-${status}`}>
                    {/* Título del estado - ahora clickeable */}
                    <tr key={`title-${status}`} className="bg-gray-50">
                      <td colSpan={9} className="px-3 py-2 sm:px-4 sm:py-3 border-b border-gray-200">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleCategoryCollapse(status)}
                            className="flex-1 text-left hover:bg-gray-100 rounded px-2 py-1 transition-colors"
                          >
                            <h3 className="text-sm sm:text-base font-semibold text-gray-900 flex items-center">
                              <span className="mr-2">
                                {status === 'pending' && '🕐'}
                                {status === 'confirmed' && '✅'}
                                {status === 'preparing' && '👨‍🍳'}
                                {status === 'ready' && '🔔'}
                                {status === 'delivered' && '📦'}
                                {status === 'cancelled' && '❌'}
                              </span>
                              {getStatusDisplayName(status)}
                              <span className="ml-2 bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded-full text-xs sm:text-sm">
                                {statusOrders.length}
                              </span>
                              <span className="ml-auto">
                                <i className={`bi ${collapsedCategories.has(status) ? 'bi-chevron-down' : 'bi-chevron-up'} text-gray-400`}></i>
                              </span>
                            </h3>
                          </button>

                          {['pending', 'confirmed', 'preparing', 'ready'].includes(status) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkGroupAsDelivered(status, statusOrders);
                              }}
                              className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors font-bold text-[10px] sm:text-xs flex items-center gap-1 shrink-0 shadow-sm border border-emerald-200"
                              title="Marcar todos como entregados"
                            >
                              <i className="bi bi-check-all"></i>
                              <span className="hidden xs:inline">Entregar todos</span>
                              <span className="xs:hidden">Todos</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Órdenes del estado - solo mostrar si no está colapsado */}
                    {!collapsedCategories.has(status) && statusOrders.map((order, orderIndex) => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        isToday={isToday}
                        isLastInGroup={orderIndex === statusOrders.length - 1}
                        isLastGroup={groupIndex === groupedOrders.length - 1}
                      />
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // Para pedidos históricos, mantener tabla simple
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <tbody className="bg-white divide-y divide-gray-200">
              {orders.map((order) => (
                <OrderRow key={order.id} order={order} isToday={isToday} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Componente para fila de orden
  const OrderRow = ({ order, isToday, isLastInGroup = false, isLastGroup = false }: {
    order: Order,
    isToday: boolean,
    isLastInGroup?: boolean,
    isLastGroup?: boolean
  }) => {
    // Agregar border-bottom más grueso entre grupos
    const borderClass = isLastInGroup && !isLastGroup
      ? "border-b-4 border-gray-300"
      : "border-b border-gray-200";

    // La expansión ahora se controla desde el padre
    const isExpanded = expandedOrderId === order.id;

    // Gestos táctiles para avanzar estado al arrastrar a la derecha
    const touchStartX = React.useRef<number | null>(null)
    const touchStartY = React.useRef<number | null>(null)
    const gestureDirection = React.useRef<'none' | 'horizontal' | 'vertical'>('none')
    const [dragOffset, setDragOffset] = useState(0)
    const swipedRef = React.useRef(false)
    const [blockHorizontalPan, setBlockHorizontalPan] = useState(false)

    const handleTouchStart = (e: React.TouchEvent) => {
      touchStartX.current = e.touches[0].clientX
      touchStartY.current = e.touches[0].clientY
      gestureDirection.current = 'none'
      swipedRef.current = false
      setDragOffset(0)
      // Evaluar si el contenedor scrollable está en el inicio para bloquear el pan horizontal a la derecha
      const scrollable = getScrollableParent(e.currentTarget as unknown as HTMLElement)
      setBlockHorizontalPan(!!scrollable && scrollable.scrollLeft <= 0)
    }

    const getScrollableParent = (el: HTMLElement | null): HTMLElement | null => {
      let node: HTMLElement | null = el?.parentElement || null
      while (node) {
        const style = window.getComputedStyle(node)
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') return node
        node = node.parentElement
      }
      return null
    }

    const handleTouchMove = (e: React.TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) return
      const currX = e.touches[0].clientX
      const currY = e.touches[0].clientY
      const dx = currX - touchStartX.current
      const dy = currY - touchStartY.current

      // Determinar dirección del gesto con umbral para evitar diagonales
      if (gestureDirection.current === 'none') {
        const absDx = Math.abs(dx)
        const absDy = Math.abs(dy)
        const activationThreshold = 8 // píxeles
        const horizontalBias = 1.3 // dx debe ser 1.3x mayor que dy
        if (absDx < activationThreshold && absDy < activationThreshold) return
        gestureDirection.current = absDx > absDy * horizontalBias && dx > 0 ? 'horizontal' : 'vertical'
      }

      if (gestureDirection.current === 'vertical') {
        // No manejar swipe si el gesto es vertical (permitir scroll)
        return
      }

      // Solo considerar arrastre a la derecha cuando el gesto es horizontal
      if (dx > 0) {
        setDragOffset(Math.min(dx, 90))
      }
    }

    const handleTouchEnd = () => {
      const threshold = 60
      if (dragOffset > threshold && !swipedRef.current) {
        swipedRef.current = true
        // Avanzar estado si corresponde
        const nextStatus = getNextStatus(order.status)
        if (isToday && nextStatus) {
          handleAdvanceStatus(order)
        }
      }
      // Reset visual
      setDragOffset(0)
      touchStartX.current = null
      touchStartY.current = null
      gestureDirection.current = 'none'
    }

    const swipeProgress = dragOffset > 0 ? Math.min(dragOffset / 90, 1) : 0

    return (
      <tr
        className={`hover:bg-gray-50 ${borderClass}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: dragOffset > 0 ? `translateX(${dragOffset}px)` : undefined,
          // Reducir vibración: no aplicar cambios de fondo mientras se arrastra ligeramente
          backgroundColor: swipeProgress >= 0.3 ? `rgba(16,185,129,${0.08 * swipeProgress})` : undefined,
          touchAction: blockHorizontalPan ? 'pan-y' as any : undefined
        }}
      >
        {/* Vista móvil - única vista */}
        <td className="w-full max-w-full">
          <div className="p-3 max-w-full">
            {/* Layout horizontal fijo: Hora | Botones | Cliente/Dirección | Expandir */}
            <div
              className="flex items-center w-full min-w-0 cursor-pointer hover:bg-gray-50 rounded transition-colors"
              onClick={() => {
                // Si esta orden ya está expandida, la contraemos
                // Si no, expandimos esta y contraemos las demás
                setExpandedOrderId(isExpanded ? null : order.id)
              }}
            >
              {/* 1. Hora - Ancho fijo */}
              <div className="flex-shrink-0 min-w-max">
                <span className={`text-xs font-medium whitespace-nowrap tabular-nums ${isOrderUpcoming(order) ? 'text-orange-600' : 'text-gray-900'}`}>
                  {isToday
                    ? (order.timing?.scheduledTime ? order.timing.scheduledTime : formatTime(getOrderDateTime(order)))
                    : formatDate(getOrderDateTime(order))}
                </span>
              </div>

              {/* 2. Botones de acción - Ancho fijo */}
              <div className="w-16 flex-shrink-0 flex justify-center">
                <div className="flex items-center space-x-1">
                  {isToday && (
                    (order.delivery?.type === 'delivery' && (order.delivery?.assignedDelivery || (order.delivery as any)?.selectedDelivery)) ||
                    (order.delivery?.type === 'pickup' && business?.phone)
                  ) && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          await handleSendWhatsAppAndAdvance(order)
                        }}
                        className={`${order.waSentToDelivery ? 'text-green-600 hover:text-green-800 hover:bg-green-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'} p-1.5 rounded transition-colors`}
                        title={order.waSentToDelivery ? 'Mensaje enviado' : 'Enviar WhatsApp'}
                      >
                        <i className="bi bi-whatsapp text-sm"></i>
                      </button>
                    )}
                  {isToday && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEditPayment(order)
                      }}
                      className={`${(() => {
                        const status = order.payment?.paymentStatus
                        if (status === 'paid') return 'text-green-600 hover:text-green-800 hover:bg-green-50'
                        if (status === 'validating') return 'text-orange-600 hover:text-orange-800 hover:bg-orange-50'
                        return 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                      })()} p-1.5 rounded`}
                    >
                      <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-bank' : order.payment?.method === 'cash' ? 'bi-coin' : 'bi-cash-coin'} text-sm`}></i>
                    </button>
                  )}
                </div>
              </div>

              {/* 3. Cliente y Dirección - Ancho flexible */}
              <div className="flex-1 min-w-0 px-2" style={{ maxWidth: 'calc(100vw - 200px)' }}>
                <div className="text-sm font-medium text-gray-900 truncate">
                  {order.customer?.name || 'Cliente sin nombre'}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {order.delivery?.type === 'delivery' ? (
                    <div className="flex items-center min-w-0">
                      <i className="bi bi-geo-alt me-1 flex-shrink-0"></i>
                      <span
                        className="truncate min-w-0"
                        title={order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia'}
                      >
                        {order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center min-w-0">
                      <i className="bi bi-shop me-1 flex-shrink-0"></i>
                      <span className="font-medium text-blue-600 truncate">Retiro en tienda</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 4. Icono expandir eliminado: la fila completa es clickeable */}
            </div>

            {/* Contenido expandible */}
            {isExpanded && (
              <div className="space-y-3 pt-2 border-t border-gray-100">
                {/* Detalles del pedido */}
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">Detalle del pedido:</div>
                  <div className="space-y-1">
                    {order.items?.map((item: any, index) => (
                      <div key={index} className="text-sm text-gray-900">
                        {item.quantity}x {item.variant || item.name || item.product?.name || 'Producto'}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Total */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Total:</span>
                  <span className="text-base font-bold text-emerald-600">
                    ${(order.total || (order as any).totalAmount || 0).toFixed(2)}
                  </span>
                </div>

                {/* Delivery (si aplica) */}
                {isToday && order.delivery?.type === 'delivery' && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">Delivery:</div>
                    <select
                      value={order.delivery?.assignedDelivery || (order.delivery as any)?.selectedDelivery || ''}
                      onChange={(e) => handleDeliveryAssignment(order.id, e.target.value)}
                      className="w-full text-sm px-2 py-1 rounded border border-gray-200"
                    >
                      <option value="">Sin asignar</option>
                      {availableDeliveries?.map((delivery) => (
                        <option key={delivery.id} value={delivery.id}>
                          {delivery.nombres}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Dirección completa (mostrar sin truncar al expandir) */}
                {order.delivery?.type === 'delivery' && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">Dirección:</div>
                    <div className="text-sm text-gray-900 break-words whitespace-normal">
                      {order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia'}
                    </div>
                  </div>
                )}

                {/* Botones de acción */}
                <div className="flex items-center justify-end space-x-1.5 pt-2">
                  {/* 1. Botón de avanzar estado */}
                  {(() => {
                    const nextStatus = getNextStatus(order.status)
                    return isToday && !!nextStatus ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleAdvanceStatus(order)
                        }}
                        className="text-green-600 hover:text-green-800 p-1.5 rounded hover:bg-green-50"
                        title={`Avanzar a ${getStatusText(nextStatus!)}`}
                      >
                        <i className="bi bi-check-lg text-xl"></i>
                      </button>
                    ) : null
                  })()}

                  {/* 2. Botón de WhatsApp para delivery/tienda */}
                  {isToday && (
                    (order.delivery?.type === 'delivery' && (order.delivery?.assignedDelivery || (order.delivery as any)?.selectedDelivery)) ||
                    (order.delivery?.type === 'pickup' && business?.phone)
                  ) && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          await handleSendWhatsAppAndAdvance(order)
                        }}
                        className={`${order.waSentToDelivery ? 'text-green-600 hover:text-green-800 hover:bg-green-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'} p-1.5 rounded transition-colors`}
                        title={order.delivery?.type === 'delivery'
                          ? (order.waSentToDelivery ? 'WhatsApp enviado al delivery' : 'Enviar WhatsApp al delivery')
                          : (order.waSentToDelivery ? 'WhatsApp enviado a la tienda' : 'Enviar WhatsApp a la tienda')}
                      >
                        <i className="bi bi-whatsapp text-xl"></i>
                      </button>
                    )}

                  {/* 3. Botón de WhatsApp al cliente */}
                  {order.customer?.phone && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSendWhatsAppToCustomer(order)
                      }}
                      className="text-green-500 hover:text-green-700 p-1.5 rounded hover:bg-green-50"
                      title="Enviar WhatsApp al cliente"
                    >
                      <i className="bi bi-chat-dots text-xl"></i>
                    </button>
                  )}

                  {/* 4. Botón de imprimir */}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        await printOrder({
                          order: order as any,
                          businessName: business?.name || '',
                          businessLogo: business?.image
                        })
                      } catch (error: any) {
                        alert(error.message || 'Error al imprimir')
                      }
                    }}
                    className="text-gray-600 hover:text-gray-800 p-1.5 rounded hover:bg-gray-50"
                    title="Imprimir comanda"
                  >
                    <i className="bi bi-printer text-xl"></i>
                  </button>

                  {isToday && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEditPayment(order)
                      }}
                      className={`${(() => {
                        const status = order.payment?.paymentStatus
                        if (status === 'paid') return 'text-green-600 hover:text-green-800 hover:bg-green-50'
                        if (status === 'validating') return 'text-orange-600 hover:text-orange-800 hover:bg-orange-50'
                        return 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                      })()} p-1.5 rounded`}
                      title="Editar método/estado de pago"
                    >
                      <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-bank' : order.payment?.method === 'cash' ? 'bi-coin' : 'bi-cash-coin'} text-xl`}></i>
                    </button>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      // Editar usando el sidebar manual
                      setManualSidebarMode('edit')
                      setEditingOrderForSidebar(order)
                      setShowManualOrderModal(true)
                    }}
                    className="text-blue-600 hover:text-blue-800 p-1.5 rounded hover:bg-blue-50"
                    title="Editar orden"
                  >
                    <i className="bi bi-pencil text-xl"></i>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteOrder(order.id)
                    }}
                    className="text-red-600 hover:text-red-800 p-1.5 rounded hover:bg-red-50"
                    title="Eliminar orden"
                  >
                    <i className="bi bi-trash text-xl"></i>
                  </button>
                </div>
              </div>
            )}
          </div>
        </td>



      </tr>
    );
  };

  // Funciones para orden manual
  const handleSearchClient = async (phone?: string) => {
    const phoneToSearch = phone || normalizePhone(manualOrderData.customerPhone.trim());
    if (!phoneToSearch) return;

    setSearchingClient(true);
    setClientFound(false);
    setShowCreateClient(false);

    try {
      const client = await searchClientByPhone(phoneToSearch);

      if (client) {
        setManualOrderData(prev => ({
          ...prev,
          customerName: client.nombres || ''
        }));
        setClientFound(true);

        // Cargar ubicaciones del cliente
        setLoadingClientLocations(true);
        const locations = await getClientLocations(client.id);
        setManualOrderData(prev => ({
          ...prev,
          customerLocations: locations
        }));
      } else {
        setClientFound(false);
        setShowCreateClient(true); // Mostrar opción para crear cliente
        setManualOrderData(prev => ({
          ...prev,
          customerName: '',
          customerLocations: []
        }));
      }
    } catch (error) {
      setClientFound(false);
      setShowCreateClient(false);
    } finally {
      setSearchingClient(false);
      setLoadingClientLocations(false);
    }
  };

  const handleCreateClient = async () => {
    if (!manualOrderData.customerName.trim() || !manualOrderData.customerPhone.trim()) {
      alert('Por favor ingresa el nombre del cliente');
      return;
    }

    setCreatingClient(true);
    try {
      const normalizedPhone = normalizePhone(manualOrderData.customerPhone);
      const newClient = await createClient({
        nombres: manualOrderData.customerName.trim(),
        celular: normalizedPhone
      });

      if (newClient) {
        setClientFound(true);
        setShowCreateClient(false);
        alert('Cliente creado exitosamente');
      }
    } catch (error) {
      alert('Error al crear el cliente');
    } finally {
      setCreatingClient(false);
    }
  };

  const handlePhoneChange = (value: string) => {
    const normalizedPhone = normalizePhone(value);

    setManualOrderData(prev => ({
      ...prev,
      customerPhone: normalizedPhone
    }));

    // Limpiar timeout anterior
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    // Limpiar estado del cliente si se está editando
    setClientFound(false);
    setManualOrderData(prev => ({
      ...prev,
      customerName: '',
      customerLocations: [],
      selectedLocation: null
    }));

    // Búsqueda automática después de 800ms de inactividad
    if (normalizedPhone.trim().length >= 8) { // Mínimo 8 dígitos para buscar
      const timeout = setTimeout(() => {
        handleSearchClient(normalizedPhone.trim());
      }, 800);
      setSearchTimeout(timeout);
    }
  };

  const normalizePhone = (phone: string) => {
    // Remover todos los caracteres no numéricos excepto el +
    let normalized = phone.replace(/[^\d+]/g, '');

    // Si empieza con +593, convertir a formato local
    if (normalized.startsWith('+593')) {
      normalized = '0' + normalized.substring(4); // +593 99 -> 099
    } else if (normalized.startsWith('593')) {
      normalized = '0' + normalized.substring(3); // 593 99 -> 099
    }

    return normalized;
  };

  const handlePastePhone = async () => {
    try {
      // Verificar si la API del clipboard está disponible
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        alert('La funcionalidad de pegar no está disponible en este navegador');
        return;
      }

      const text = await navigator.clipboard.readText();
      if (text) {
        const normalizedPhone = normalizePhone(text);
        setManualOrderData(prev => ({
          ...prev,
          customerPhone: normalizedPhone
        }));

        // Buscar inmediatamente después de pegar
        if (normalizedPhone.length >= 8) {
          setTimeout(() => {
            handleSearchClient(normalizedPhone);
          }, 100);
        }
      }
    } catch (error) {
      // Fallback: solicitar al usuario que pegue manualmente
      const manualInput = prompt('Pega el número de teléfono aquí:');
      if (manualInput) {
        const normalizedPhone = normalizePhone(manualInput);
        setManualOrderData(prev => ({
          ...prev,
          customerPhone: normalizedPhone
        }));

        if (normalizedPhone.length >= 8) {
          setTimeout(() => {
            handleSearchClient(normalizedPhone);
          }, 100);
        }
      }
    }
  };

  const handleAddProductToOrder = (product: Product) => {
    if (product.variants && product.variants.length > 0) {
      setSelectedProductForVariants(product);
      setIsVariantModalOpen(true);
    } else {
      // Producto sin variantes
      const existingProductIndex = manualOrderData.selectedProducts.findIndex(p => p.id === product.id);

      if (existingProductIndex >= 0) {
        const newProducts = [...manualOrderData.selectedProducts];
        newProducts[existingProductIndex].quantity += 1;
        setManualOrderData(prev => ({
          ...prev,
          selectedProducts: newProducts
        }));
      } else {
        setManualOrderData(prev => ({
          ...prev,
          selectedProducts: [...prev.selectedProducts, {
            id: product.id,
            name: product.name,
            price: product.price,
            quantity: 1
          }]
        }));
      }
    }
  };

  const handleAddVariantToOrder = (variant: ProductVariant) => {
    if (!selectedProductForVariants) return;

    const variantKey = `${selectedProductForVariants.id}-${variant.name}`;
    const existingProductIndex = manualOrderData.selectedProducts.findIndex(p =>
      p.id === selectedProductForVariants.id && p.variant === variant.name
    );

    if (existingProductIndex >= 0) {
      const newProducts = [...manualOrderData.selectedProducts];
      newProducts[existingProductIndex].quantity += 1;
      setManualOrderData(prev => ({
        ...prev,
        selectedProducts: newProducts
      }));
    } else {
      setManualOrderData(prev => ({
        ...prev,
        selectedProducts: [...prev.selectedProducts, {
          id: selectedProductForVariants.id,
          name: `${selectedProductForVariants.name} - ${variant.name}`,
          price: variant.price,
          quantity: 1,
          variant: variant.name
        }]
      }));
    }

    setIsVariantModalOpen(false);
    setSelectedProductForVariants(null);
  };

  const handleCreateManualOrder = async () => {
    if (!business || !clientFound || manualOrderData.selectedProducts.length === 0) return;

    try {
      const subtotal = manualOrderData.selectedProducts.reduce((sum, item) =>
        sum + (item.price * item.quantity), 0
      );

      // Calcular costo de envío
      const deliveryCost = manualOrderData.deliveryType === 'delivery' && manualOrderData.selectedLocation
        ? parseFloat(manualOrderData.selectedLocation.tarifa || '0')
        : 0;

      const totalAmount = subtotal + deliveryCost;

      // Calcular hora de entrega unificada
      let scheduledTime, scheduledDate;

      if (manualOrderData.timingType === 'immediate') {
        // Para inmediato: fecha y hora actuales + 30 minutos
        const deliveryTime = new Date(Date.now() + 30 * 60 * 1000);
        scheduledDate = Timestamp.fromDate(deliveryTime);
        scheduledTime = deliveryTime.toTimeString().slice(0, 5); // HH:MM
      } else {
        // Para programado: crear fecha en zona horaria de Ecuador (UTC-5)
        const selectedDate = manualOrderData.scheduledDate;
        const selectedTime = manualOrderData.scheduledTime;

        // Parsear la fecha seleccionada (formato YYYY-MM-DD)
        const [year, month, day] = selectedDate.split('-').map(Number);
        const [hours, minutes] = selectedTime.split(':').map(Number);

        // Crear fecha en zona horaria local (Ecuador)
        const programmedDate = new Date(year, month - 1, day, hours, minutes);

        // Verificar que la fecha sea válida
        if (isNaN(programmedDate.getTime())) {
          throw new Error('Fecha programada inválida');
        }

        scheduledDate = Timestamp.fromDate(programmedDate);
        scheduledTime = selectedTime;
      }

      const orderData = {
        businessId: businessId || '',
        items: manualOrderData.selectedProducts.map(item => ({
          productId: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          variant: item.variant
        })),
        customer: {
          name: manualOrderData.customerName,
          phone: manualOrderData.customerPhone
        },
        delivery: {
          type: manualOrderData.deliveryType,
          references: manualOrderData.selectedLocation?.referencia || '',
          latlong: manualOrderData.selectedLocation?.latlong || '',
          assignedDelivery: manualOrderData.selectedDelivery?.id,
          deliveryCost
        },
        total: totalAmount,
        subtotal,
        status: 'confirmed' as const,
        payment: {
          method: manualOrderData.paymentMethod,
          paymentStatus: manualOrderData.paymentStatus,
          selectedBank: manualOrderData.selectedBank,
          ...(manualOrderData.paymentMethod === 'mixed' && {
            cashAmount: manualOrderData.cashAmount,
            transferAmount: manualOrderData.transferAmount
          })
        },
        createdByAdmin: true,
        timing: {
          type: manualOrderData.timingType,
          scheduledDate,
          scheduledTime
        }
      };

      const orderId = await createOrder(orderData as any);

      // Registrar consumo de ingredientes automáticamente para órdenes manuales
      try {
        const orderDateStr = new Date().toISOString().split('T')[0]
        await registerOrderConsumption(
          selectedBusinessId || '',
          manualOrderData.selectedProducts.map(p => ({
            productId: p.id,
            variant: p.variant,
            name: p.name,
            quantity: p.quantity
          })),
          orderDateStr,
          orderId
        )
      } catch (error) {
        console.error('[Dashboard] Error registering consumption:', error)
      }

      // Limpiar formulario
      setManualOrderData({
        customerPhone: '',
        customerName: '',
        selectedProducts: [],
        deliveryType: '',
        selectedLocation: null,
        customerLocations: [],
        timingType: 'immediate',
        scheduledDate: '',
        scheduledTime: '',
        paymentMethod: 'cash',
        selectedBank: '',
        paymentStatus: 'pending',
        cashAmount: 0,
        transferAmount: 0,
        total: 0,
        selectedDelivery: null
      });
      setClientFound(false);
      setShowManualOrderModal(false); // Cerrar el modal

      setActiveTab('orders'); // Cambiar a la pestaña de pedidos

      // Recargar pedidos
      if (selectedBusinessId) {
        const ordersData = await getRecentOrdersByBusiness(selectedBusinessId);
        setOrders(ordersData);
      }
    } catch (error) {
      alert('Error al crear el pedido');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-600"></div>
          <p className="mt-4 text-gray-600">Cargando dashboard...</p>
        </div>
      </div>
    )
  }

  if (!business) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">No se pudo cargar la información del negocio</p>
          <button
            onClick={() => router.push('/business/login')}
            className="mt-4 bg-red-600 text-white px-4 py-2 rounded-lg"
          >
            Volver al Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Layout con Sidebar - sin header aquí */}
      <div className="flex flex-1 overflow-hidden">
        {/* Overlay solo en móvil */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div className={`
          w-64 bg-white shadow-sm border-r border-gray-200 fixed h-full overflow-y-auto z-50 transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <div className="p-4">
            {/* Header del sidebar */}
            <div className="flex justify-between items-center mb-4">
              <span className="font-semibold text-gray-900">Menú</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-lg text-gray-600 hover:bg-gray-100"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <nav className="space-y-2">
              <button
                onClick={() => {
                  setActiveTab('orders')
                  setSidebarOpen(false)
                }}
                className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${activeTab === 'orders'
                  ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                  : 'text-gray-700 hover:bg-gray-50'
                  }`}
              >
                <i className="bi bi-clipboard-check me-3 text-lg"></i>
                <span className="font-medium">Pedidos</span>
                <span className="ml-auto bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-xs">
                  {orders.length}
                </span>
              </button>

              <div>
                <button
                  onClick={() => setIsTiendaMenuOpen(!isTiendaMenuOpen)}
                  className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${activeTab === 'profile'
                    ? 'bg-red-50 text-red-600'
                    : 'text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  <i className="bi bi-shop me-3 text-lg"></i>
                  <span className="font-medium">Tienda</span>
                  <i className={`bi bi-chevron-down ml-auto transition-transform ${isTiendaMenuOpen ? 'rotate-180' : ''}`}></i>
                </button>

                {(isTiendaMenuOpen || activeTab === 'profile') && (
                  <div className="ml-9 mt-1 space-y-1">
                    {[
                      { id: 'general', label: 'Generales', icon: 'bi-info-circle' },
                      { id: 'products', label: 'Productos', icon: 'bi-box-seam' },
                      { id: 'fidelizacion', label: 'Fidelización', icon: 'bi-gift' }
                    ].map((sub) => (
                      <button
                        key={sub.id}
                        onClick={() => {
                          setActiveTab('profile')
                          setProfileSubTab(sub.id as any)
                          setSidebarOpen(false)
                        }}
                        className={`w-full flex items-center px-3 py-2 text-sm rounded-lg transition-colors ${activeTab === 'profile' && profileSubTab === sub.id
                          ? 'text-red-600 bg-red-50 font-bold'
                          : 'text-gray-600 hover:bg-gray-50'
                          }`}
                      >
                        <i className={`bi ${sub.icon} me-2`}></i>
                        {sub.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  setActiveTab('admins')
                  setSidebarOpen(false)
                }}
                className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${activeTab === 'admins'
                  ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                  : 'text-gray-700 hover:bg-gray-50'
                  }`}
              >
                <i className="bi bi-people me-3 text-lg"></i>
                <span className="font-medium">Administradores</span>
              </button>

              <div>
                <button
                  onClick={() => setIsReportsMenuOpen(!isReportsMenuOpen)}
                  className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${activeTab === 'reports'
                    ? 'bg-red-50 text-red-600'
                    : 'text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  <i className="bi bi-graph-up me-3 text-lg"></i>
                  <span className="font-medium">Reportes</span>
                  <i className={`bi bi-chevron-down ml-auto transition-transform ${isReportsMenuOpen ? 'rotate-180' : ''}`}></i>
                </button>

                {(isReportsMenuOpen || activeTab === 'reports') && (
                  <div className="ml-9 mt-1 space-y-1">
                    {[
                      { id: 'general', label: 'General', icon: 'bi-graph-up' },
                      { id: 'deliveries', label: 'Por delivery', icon: 'bi-truck' },
                      { id: 'costs', label: 'Costos e ingredientes', icon: 'bi-basket' }
                    ].map((sub) => (
                      <button
                        key={sub.id}
                        onClick={() => {
                          setActiveTab('reports')
                          setReportsSubTab(sub.id as any)
                          setSidebarOpen(false)
                        }}
                        className={`w-full flex items-center px-3 py-2 text-sm rounded-lg transition-colors ${activeTab === 'reports' && reportsSubTab === sub.id
                          ? 'text-red-600 bg-red-50 font-bold'
                          : 'text-gray-600 hover:bg-gray-50'
                          }`}
                      >
                        <i className={`bi ${sub.icon} me-2`}></i>
                        {sub.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  setActiveTab('inventory')
                  setSidebarOpen(false)
                }}
                className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${activeTab === 'inventory'
                  ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                  : 'text-gray-700 hover:bg-gray-50'
                  }`}
              >
                <i className="bi bi-box-seam me-3 text-lg"></i>
                <span className="font-medium">Inventario / Stock</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('qrcodes')
                  setSidebarOpen(false)
                }}
                className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${activeTab === 'qrcodes'
                  ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                  : 'text-gray-700 hover:bg-gray-50'
                  }`}
              >
                <i className="bi bi-qr-code me-3 text-lg"></i>
                <span className="font-medium">Códigos QR</span>
              </button>

              {/* Botón de Notificaciones - solo si no es iOS y necesita acción */}
              {!isIOS && needsUserAction && (
                <button
                  onClick={requestPermission}
                  className="w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors bg-blue-50 text-blue-600 hover:bg-blue-100 border-l-4 border-blue-500"
                >
                  <i className="bi bi-bell me-3 text-lg"></i>
                  <span className="font-medium">Activar Notificaciones</span>
                </button>
              )}
            </nav>
          </div>
        </div>
        <div className={`flex-1 transition-all duration-300 ease-in-out overflow-y-auto ${sidebarOpen ? 'ml-64' : 'ml-0'}`}>
          {/* Header - ahora dentro del contenedor scrollable */}
          <header className="bg-white shadow-sm border-b sticky top-0 z-10">
            <div className="px-4 sm:px-6">
              <div className="flex justify-between items-center py-3 sm:py-4">
                <div className="flex items-center space-x-3">
                  {/* Botón de menú móvil */}
                  <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <i className="bi bi-list text-xl"></i>
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab('orders');
                      setOrdersSubTab('today');
                    }}
                    className="text-xl sm:text-2xl font-bold text-red-600 hover:text-red-700 transition-colors"
                  >
                    Fuddi
                  </button>
                  <span className="hidden sm:inline text-gray-600">Dashboard</span>
                </div>

                <div className="flex items-center space-x-2 sm:space-x-4">
                  {/* Control Manual de Tienda */}
                  {business && (
                    <div className="flex items-center gap-2">
                      <div className="hidden sm:flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                        <div className={`w-2 h-2 rounded-full ${isStoreOpen(business) ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                          }`} />
                        <span className="text-sm font-medium text-gray-700">
                          {isStoreOpen(business) ? 'Abierto' : 'Cerrado'}
                        </span>
                      </div>

                      <button
                        onClick={handleToggleStoreStatus}
                        disabled={updatingStoreStatus}
                        className="px-3 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 disabled:opacity-50"
                        title={
                          business.manualStoreStatus === null || business.manualStoreStatus === undefined
                            ? 'Modo automático (según horario)'
                            : business.manualStoreStatus === 'open'
                              ? 'Forzar abierto (ignorar horario)'
                              : 'Forzar cerrado (ignorar horario)'
                        }
                      >
                        <i className={`bi ${business.manualStoreStatus === 'open'
                          ? 'bi-unlock-fill text-green-600'
                          : business.manualStoreStatus === 'closed'
                            ? 'bi-lock-fill text-red-600'
                            : `bi-clock-fill ${isStoreOpen(business) ? 'text-green-600' : 'text-gray-400'}`
                          }`} />
                        <span className="hidden sm:inline text-sm font-medium">
                          {business.manualStoreStatus === null || business.manualStoreStatus === undefined
                            ? 'Auto'
                            : business.manualStoreStatus === 'open'
                              ? 'Forzar Abierto'
                              : 'Forzar Cerrado'}
                        </span>
                      </button>
                    </div>
                  )}

                  {/* Campana de notificaciones */}
                  {selectedBusinessId && (
                    <NotificationsBell
                      businessId={selectedBusinessId}
                      onNewOrder={handleNewOrder}
                    />
                  )}

                  {/* Selector de Tiendas con imagen */}
                  <div className="relative business-dropdown-container">
                    <button
                      onClick={() => setShowBusinessDropdown(!showBusinessDropdown)}
                      className="flex items-center space-x-2 sm:space-x-3 bg-gray-50 hover:bg-gray-100 px-2 sm:px-3 py-2 rounded-lg transition-colors"
                    >
                      {/* Imagen de perfil de la tienda */}
                      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                        {business?.image ? (
                          <img
                            src={business.image}
                            alt={business.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <i className="bi bi-shop text-gray-400 text-xs sm:text-sm"></i>
                          </div>
                        )}
                      </div>

                      <div className="hidden sm:flex items-center space-x-2">
                        <div className="flex flex-col">
                          <span className="text-gray-700 font-medium">
                            {business?.name || 'Cargando...'}
                          </span>
                          {userRole && (
                            <span className="text-xs text-gray-500">
                              {userRole === 'owner' ? 'Propietario' :
                                userRole === 'admin' ? 'Administrador' : 'Gerente'}
                            </span>
                          )}
                        </div>
                        <i className={`bi bi-chevron-down text-gray-500 text-xs transition-transform ${showBusinessDropdown ? 'rotate-180' : ''
                          }`}></i>
                      </div>

                      {/* Solo flecha en móvil */}
                      <i className={`sm:hidden bi bi-chevron-down text-gray-500 text-xs transition-transform ${showBusinessDropdown ? 'rotate-180' : ''
                        }`}></i>
                    </button>

                    {/* Dropdown */}
                    {showBusinessDropdown && (
                      <div className="absolute right-0 mt-2 w-64 sm:w-72 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-20">
                        {/* Tiendas existentes */}
                        {businesses.map((biz) => {
                          // Determinar el rol del usuario en esta tienda
                          const user = auth.currentUser;
                          const isOwner = user && biz.ownerId === user.uid;
                          const adminRole = biz.administrators?.find(
                            admin => admin.email === user?.email
                          );
                          const role = isOwner ? 'owner' : (adminRole?.role || 'admin');

                          return (
                            <button
                              key={biz.id}
                              onClick={() => handleBusinessChange(biz.id)}
                              className={`w-full flex items-center space-x-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${selectedBusinessId === biz.id ? 'bg-red-50 border-r-2 border-red-500' : ''
                                }`}
                            >
                              <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                                {biz.image ? (
                                  <img
                                    src={biz.image}
                                    alt={biz.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full bg-gray-200 rounded-full flex items-center justify-center">
                                    <i className="bi bi-shop text-gray-400 text-sm"></i>
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 truncate">{biz.name}</p>
                                <div className="flex items-center space-x-2">
                                  <p className="text-sm text-gray-500 truncate">@{biz.username}</p>
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${role === 'owner'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-blue-100 text-blue-700'
                                    }`}>
                                    {role === 'owner' ? 'Propietario' :
                                      role === 'admin' ? 'Admin' : 'Gerente'}
                                  </span>
                                </div>
                              </div>
                              {selectedBusinessId === biz.id && (
                                <i className="bi bi-check-circle-fill text-red-500 flex-shrink-0"></i>
                              )}
                            </button>
                          );
                        })}

                        {/* Separador */}
                        {businesses.length > 0 && (
                          <hr className="my-2 border-gray-200" />
                        )}

                        {/* Crear nueva tienda */}
                        <button
                          onClick={() => {
                            setShowBusinessDropdown(false);
                            router.push('/business/register');
                          }}
                          className="w-full flex items-center space-x-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors text-red-600"
                        >
                          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                            <i className="bi bi-plus text-red-600"></i>
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium">Crear Nueva Tienda</p>
                            <p className="text-sm text-gray-500">Agregar otra tienda</p>
                          </div>
                        </button>

                        {/* Separador antes de logout */}
                        <hr className="my-2 border-gray-200" />

                        {/* Logout */}
                        <button
                          onClick={() => {
                            setShowBusinessDropdown(false);
                            handleLogout();
                          }}
                          className="w-full flex items-center space-x-3 px-4 py-3 text-left hover:bg-red-50 transition-colors text-red-600"
                        >
                          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                            <i className="bi bi-box-arrow-right text-red-600"></i>
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium">Cerrar Sesión</p>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </header>

          <div className="mx-auto px-4 sm:px-6 py-4 sm:py-8">

            {/* Orders Tab */}
            {activeTab === 'orders' && (
              <div className="space-y-6">
                {/* Sub-pestañas para pedidos */}
                <div className="border-b border-gray-200">
                  <nav className="-mb-px flex space-x-8">
                    <button
                      onClick={() => setOrdersSubTab('today')}
                      className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${ordersSubTab === 'today'
                        ? 'border-red-500 text-red-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                      <i className="bi bi-calendar-check me-2"></i>
                      Pedidos de hoy
                      {(() => {
                        const { todayOrders } = categorizeOrders();
                        return todayOrders.length > 0 && (
                          <span className="ml-2 bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs">
                            {todayOrders.length}
                          </span>
                        );
                      })()}
                    </button>
                    <button
                      onClick={() => setOrdersSubTab('history')}
                      className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${ordersSubTab === 'history'
                        ? 'border-red-500 text-red-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                      <i className="bi bi-journal-text me-2"></i>
                      Historial
                      {(() => {
                        const { pastOrders, upcomingOrders } = categorizeOrders();
                        const totalHistorial = pastOrders.length + upcomingOrders.length;
                        return totalHistorial > 0 && (
                          <span className="ml-2 bg-gray-100 text-gray-800 px-2 py-1 rounded-full text-xs">
                            {totalHistorial}
                          </span>
                        );
                      })()}
                    </button>
                  </nav>
                </div>

                {/* Contenido de las pestañas */}
                {ordersSubTab === 'today' && (
                  <div>
                    {(() => {
                      const { todayOrders } = categorizeOrders();

                      return todayOrders.length === 0 ? (
                        <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
                          <div className="text-6xl mb-4">📅</div>
                          <h3 className="text-lg font-medium text-gray-900 mb-2">No tienes pedidos para hoy</h3>
                          <p className="text-gray-500 text-sm">Los nuevos pedidos aparecerán aquí</p>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-gray-900">
                              {(() => {
                                const cashTotal = todayOrders
                                  .reduce((sum, order) => {
                                    if (order.payment?.method === 'cash') {
                                      return sum + (order.total || 0);
                                    } else if (order.payment?.method === 'mixed') {
                                      return sum + ((order.payment as any)?.cashAmount || 0);
                                    }
                                    return sum;
                                  }, 0);

                                const transferTotal = todayOrders
                                  .reduce((sum, order) => {
                                    if (order.payment?.method === 'transfer') {
                                      return sum + (order.total || 0);
                                    } else if (order.payment?.method === 'mixed') {
                                      return sum + ((order.payment as any)?.transferAmount || 0);
                                    }
                                    return sum;
                                  }, 0);

                                return (
                                  <span className="flex items-center space-x-4">
                                    <span className="text-green-600">
                                      <i className="bi bi-cash me-1"></i>
                                      ${cashTotal.toFixed(2)}
                                    </span>
                                    <span className="text-blue-600">
                                      <i className="bi bi-bank me-1"></i>
                                      ${transferTotal.toFixed(2)}
                                    </span>
                                  </span>
                                );
                              })()}
                            </h2>
                            <span className="text-sm text-gray-500">
                              {new Date().toLocaleDateString('es-EC', {
                                weekday: 'long',
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                              })}
                            </span>
                          </div>
                          <OrdersTable orders={todayOrders} isToday={true} />
                        </div>
                      );
                    })()}
                  </div>
                )}
                {ordersSubTab === 'history' && (
                  <OrderHistory
                    orders={[...orders, ...historicalOrders]}
                    onOrderEdit={handleEditOrder}
                    onOrderDelete={handleDeleteOrder}
                    onOrderStatusChange={handleStatusChange}
                    getStatusColor={getStatusColor}
                    getStatusText={getStatusText}
                    formatDate={formatDate}
                    formatTime={formatTime}
                    getOrderDateTime={getOrderDateTime}
                    OrderRow={OrderRow}
                  />
                )}
              </div>
            )}

            {/* Profile Tab */}
            {activeTab === 'profile' && business && (
              <BusinessProfileDashboard
                key={profileSubTab}
                business={business}
                editedBusiness={editedBusiness}
                isEditingProfile={isEditingProfile}
                uploadingCover={uploadingCover}
                uploadingProfile={uploadingProfile}
                uploadingLocation={uploadingLocation}
                products={products}
                categories={businessCategories}
                onCoverImageUpload={handleCoverImageUpload}
                onProfileImageUpload={handleProfileImageUpload}
                onLocationImageUpload={handleLocationImageUpload}
                onEditProfile={handleEditProfile}
                onCancelEdit={handleCancelEdit}
                onSaveProfile={handleSaveProfile}
                onBusinessFieldChange={handleBusinessFieldChange}
                onScheduleFieldChange={handleScheduleFieldChange}
                onToggleDayOpen={toggleDayOpen}
                onProductsChange={setProducts}
                onCategoriesChange={setBusinessCategories}
                initialTab={profileSubTab}
              />
            )}

            {/* Administrators Tab */}
            {activeTab === 'admins' && (
              <div>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3 sm:mb-0">
                    <i className="bi bi-people me-2"></i>Administradores
                  </h2>
                  <button
                    onClick={() => setShowAddAdminModal(true)}
                    className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm sm:text-base"
                  >
                    <i className="bi bi-person-plus me-2"></i>
                    Agregar Administrador
                  </button>
                </div>

                {/* Lista de administradores */}
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                  <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-medium text-gray-900">
                      Propietario y Administradores
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Gestiona quién puede administrar tu tienda
                    </p>
                  </div>

                  <div className="divide-y divide-gray-200">
                    {/* Propietario */}
                    <div className="px-4 sm:px-6 py-4">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                        <div className="flex items-center mb-3 sm:mb-0">
                          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                            <i className="bi bi-crown text-red-600"></i>
                          </div>
                          <div className="ml-3">
                            <p className="text-sm font-medium text-gray-900">{business.email}</p>
                            <p className="text-sm text-gray-500">Propietario</p>
                          </div>
                        </div>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Todos los permisos
                        </span>
                      </div>
                    </div>

                    {/* Administradores */}
                    {business.administrators && business.administrators.length > 0 ? (
                      business.administrators.map((admin, index) => (
                        <div key={index} className="px-4 sm:px-6 py-4">
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                            <div className="flex items-center mb-3 sm:mb-0">
                              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                                <i className="bi bi-person text-blue-600"></i>
                              </div>
                              <div className="ml-3">
                                <p className="text-sm font-medium text-gray-900">{admin.email}</p>
                                <p className="text-sm text-gray-500 capitalize">{admin.role}</p>
                              </div>
                            </div>
                            <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                {admin.role === 'admin' ? 'Administrador' : 'Gerente'}
                              </span>
                              <button
                                onClick={() => handleRemoveAdmin(admin.email)}
                                className="text-red-600 hover:text-red-700 text-sm"
                              >
                                <i className="bi bi-trash me-1"></i>
                                Remover
                              </button>
                            </div>
                          </div>

                          {/* Permisos */}
                          <div className="mt-3 sm:ml-13">
                            <p className="text-xs text-gray-500 mb-2">Permisos:</p>
                            <div className="flex flex-wrap gap-1">
                              {admin.permissions.manageProducts && (
                                <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                                  Productos
                                </span>
                              )}
                              {admin.permissions.manageOrders && (
                                <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                                  Pedidos
                                </span>
                              )}
                              {admin.permissions.viewReports && (
                                <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                                  Reportes
                                </span>
                              )}
                              {admin.permissions.editBusiness && (
                                <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                                  Editar Tienda
                                </span>
                              )}
                              {admin.permissions.manageAdmins && (
                                <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                                  Administradores
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="px-4 sm:px-6 py-8 text-center">
                        <i className="bi bi-people text-gray-400 text-4xl mb-4"></i>
                        <p className="text-gray-500">No hay administradores adicionales</p>
                        <p className="text-sm text-gray-400 mt-1">
                          Agrega administradores para que te ayuden a gestionar tu tienda
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Modal para agregar administrador */}
                {showAddAdminModal && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg max-w-md w-full max-h-screen overflow-y-auto">
                      <div className="px-6 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-medium text-gray-900">
                          Agregar Administrador
                        </h3>
                      </div>

                      <div className="px-6 py-4 space-y-4">
                        {/* Email */}
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

                        {/* Rol */}
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

                        {/* Permisos */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Permisos
                          </label>
                          <div className="space-y-2">
                            {[
                              { key: 'manageProducts', label: 'Gestionar Productos' },
                              { key: 'manageOrders', label: 'Gestionar Pedidos' },
                              { key: 'viewReports', label: 'Ver Reportes' },
                              { key: 'editBusiness', label: 'Editar Información de la Tienda' },
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
                          disabled={addingAdmin || !newAdminData.email.trim()}
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
              </div>
            )}

            {/* Reports Tab */}
            {activeTab === 'reports' && (
              <CostReports
                key={reportsSubTab}
                business={business}
                initialReportType={reportsSubTab}
              />
            )}

            {/* Inventory Tab */}
            {activeTab === 'inventory' && (
              <IngredientStockManagement business={business} />
            )}

            {/* QR Codes Tab */}
            {activeTab === 'qrcodes' && (
              <QRCodesContent businessId={businessId} />
            )}

          </div>
        </div>



        {/* Modal de Detalles del Pedido */}
        {showOrderDetailsModal && selectedOrderDetails && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">
                    Detalles del Pedido
                  </h2>
                  <button
                    onClick={() => setShowOrderDetailsModal(false)}
                    className="text-gray-500 hover:text-gray-700 text-2xl"
                  >
                    ×
                  </button>
                </div>

                {/* Información del Cliente */}
                <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    <i className="bi bi-person-fill me-2"></i>
                    Información del Cliente
                  </h3>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <span className="text-sm font-medium text-gray-500">Nombre:</span>
                      <p className="text-gray-900">{selectedOrderDetails.customer?.name || 'Sin nombre'}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-500">Teléfono:</span>
                      <p className="text-gray-900">{selectedOrderDetails.customer?.phone || 'Sin teléfono'}</p>
                    </div>
                  </div>
                </div>

                {/* Información de Entrega */}
                <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    <i className="bi bi-truck me-2"></i>
                    Información de Entrega
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm font-medium text-gray-500">Tipo:</span>
                      <span className={`ml-2 px-2 py-1 rounded text-sm ${selectedOrderDetails.delivery?.type === 'delivery'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-green-100 text-green-800'
                        }`}>
                        {selectedOrderDetails.delivery?.type === 'delivery' ? 'Domicilio' : 'Retiro en tienda'}
                      </span>
                    </div>
                    {selectedOrderDetails.delivery?.type === 'delivery' && (
                      <div>
                        <span className="text-sm font-medium text-gray-500">Dirección:</span>
                        <p className="text-gray-900 mt-1">
                          {selectedOrderDetails.delivery?.references || (selectedOrderDetails.delivery as any)?.reference || 'Sin referencia'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Productos */}
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    <i className="bi bi-bag-fill me-2"></i>
                    Productos ({selectedOrderDetails.items?.length || 0})
                  </h3>
                  <div className="space-y-3">
                    {selectedOrderDetails.items?.map((item: any, index) => (
                      <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">
                            {item.name || item.product?.name || 'Producto'}
                          </p>
                          {item.variant && (
                            <p className="text-sm text-gray-500">Variante: {item.variant}</p>
                          )}
                          <p className="text-sm text-gray-500">Cantidad: {item.quantity}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-gray-900">
                            ${((item.price || 0) * (item.quantity || 1)).toFixed(2)}
                          </p>
                          <p className="text-sm text-gray-500">
                            ${(item.price || 0).toFixed(2)} c/u
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Información de Pago */}
                <div className="mb-6 p-4 bg-green-50 rounded-lg">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    <i className="bi bi-bank me-2"></i>
                    Información de Pago
                  </h3>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <span className="text-sm font-medium text-gray-500">Método:</span>
                      <p className="text-gray-900">
                        {selectedOrderDetails.payment?.method === 'cash' ? 'Efectivo' : 'Transferencia'}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-500">Estado:</span>
                      <span className={`ml-1 px-2 py-1 rounded text-sm ${selectedOrderDetails.payment?.paymentStatus === 'paid'
                        ? 'bg-green-100 text-green-800'
                        : selectedOrderDetails.payment?.paymentStatus === 'validating'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                        }`}>
                        {selectedOrderDetails.payment?.paymentStatus === 'paid' ? 'Pagado' :
                          selectedOrderDetails.payment?.paymentStatus === 'validating' ? 'Validando' : 'Pendiente'}
                      </span>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-500">Total:</span>
                      <p className="text-xl font-bold text-green-600">
                        ${(selectedOrderDetails.total || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Estado y Fechas */}
                <div className="mb-6 p-4 bg-purple-50 rounded-lg">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    <i className="bi bi-info-circle-fill me-2"></i>
                    Estado del Pedido
                  </h3>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <span className="text-sm font-medium text-gray-500">Estado actual:</span>
                      <span className={`ml-2 px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(selectedOrderDetails.status)}`}>
                        {selectedOrderDetails.status === 'pending' && '🕐 Pendiente'}
                        {selectedOrderDetails.status === 'confirmed' && '✅ Confirmado'}
                        {selectedOrderDetails.status === 'preparing' && '👨‍🍳 Preparando'}
                        {selectedOrderDetails.status === 'ready' && '🔔 Listo'}
                        {selectedOrderDetails.status === 'delivered' && '📦 Entregado'}
                        {selectedOrderDetails.status === 'cancelled' && '❌ Cancelado'}
                      </span>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-500">Fecha del pedido:</span>
                      <p className="text-gray-900">
                        {formatDate(getOrderDateTime(selectedOrderDetails))} {formatTime(getOrderDateTime(selectedOrderDetails))}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Acciones rápidas */}
                <div className="flex space-x-3">
                  <button
                    onClick={() => {
                      setShowOrderDetailsModal(false)
                      // Abrir sidebar en modo edición desde detalles
                      setManualSidebarMode('edit')
                      setEditingOrderForSidebar(selectedOrderDetails)
                      setShowManualOrderModal(true)
                    }}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <i className="bi bi-pencil me-2"></i>
                    Editar Pedido
                  </button>
                  <button
                    onClick={() => setShowOrderDetailsModal(false)}
                    className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Edición de Método de Pago */}

        {showEditPaymentModal && paymentEditingOrder && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-md w-full">
              <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-gray-900">
                    <i className="bi bi-credit-card me-2"></i>
                    Editar Método de Pago
                  </h2>
                  <button
                    onClick={() => setShowEditPaymentModal(false)}
                    className="text-gray-500 hover:text-gray-700 text-2xl"
                  >
                    ×
                  </button>
                </div>

                {/* Información del pedido */}
                <div className="mb-6 p-4 bg-gray-50 rounded-lg flex justify-between items-start">
                  <div>
                    <p className="text-sm text-gray-600">Pedido de:</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {paymentEditingOrder.customer?.name || 'Cliente sin nombre'}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      Total: <span className="font-bold text-emerald-600">
                        ${(paymentEditingOrder.total || 0).toFixed(2)}
                      </span>
                    </p>
                  </div>

                  {/* Mostrar comprobante si existe */}
                  {paymentEditingOrder.payment?.receiptImageUrl && (
                    <div className="ml-4">
                      <p className="text-xs text-gray-500 mb-1 text-center">Comprobante</p>
                      <button
                        type="button"
                        onClick={() => setShowReceiptPreviewModal(true)}
                        className="block relative group"
                        title="Ver comprobante completo"
                      >
                        <img
                          src={paymentEditingOrder.payment.receiptImageUrl}
                          alt="Comprobante de pago"
                          className="w-24 h-24 object-cover rounded-lg border border-gray-200 shadow-sm hover:opacity-90 transition-opacity"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-all rounded-lg">
                          <i className="bi bi-zoom-in text-white opacity-0 group-hover:opacity-100 drop-shadow-md"></i>
                        </div>
                      </button>
                    </div>
                  )}
                </div>

                {/* Selección de método de pago */}
                <div className="space-y-4 mb-6">
                  <label className="block text-sm font-medium text-gray-700">
                    Método de Pago
                  </label>

                  <div className="space-y-3">
                    <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="cash"
                        checked={editPaymentData.method === 'cash'}
                        onChange={(e) => setEditPaymentData({
                          ...editPaymentData,
                          method: e.target.value as 'cash',
                          cashAmount: 0,
                          transferAmount: 0,
                          paymentStatus: 'pending'
                        })}
                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
                      />
                      <span className="ml-3 text-gray-700">
                        <i className="bi bi-cash me-2 text-green-600"></i>
                        Efectivo
                      </span>
                    </label>

                    <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="transfer"
                        checked={editPaymentData.method === 'transfer'}
                        onChange={(e) => setEditPaymentData({
                          ...editPaymentData,
                          method: e.target.value as 'transfer',
                          cashAmount: 0,
                          transferAmount: 0,
                          paymentStatus: 'paid'
                        })}
                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
                      />
                      <span className="ml-3 text-gray-700">
                        <i className="bi bi-credit-card me-2 text-blue-600"></i>
                        Transferencia
                      </span>
                    </label>

                    <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="mixed"
                        checked={editPaymentData.method === 'mixed'}
                        onChange={(e) => setEditPaymentData({
                          ...editPaymentData,
                          method: e.target.value as 'mixed',
                          cashAmount: 0,
                          transferAmount: 0,
                          paymentStatus: 'pending'
                        })}
                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
                      />
                      <span className="ml-3 text-gray-700">
                        <i className="bi bi-cash-coin me-2 text-yellow-600"></i>
                        Mixto (Efectivo + Transferencia)
                      </span>
                    </label>
                  </div>

                  {/* Selector de estado de pago (debajo de Método de Pago) */}
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Estado del Pago
                    </label>
                    <select
                      value={editPaymentData.paymentStatus}
                      onChange={(e) => setEditPaymentData({
                        ...editPaymentData,
                        paymentStatus: e.target.value as 'pending' | 'validating' | 'paid'
                      })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm bg-white"
                    >
                      <option value="pending">Pendiente</option>
                      <option value="validating">Validando</option>
                      <option value="paid">Pagado</option>
                    </select>
                  </div>

                  {/* Montos para pago mixto */}
                  {editPaymentData.method === 'mixed' && (
                    <div className="mt-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                      <h4 className="text-sm font-medium text-gray-900 mb-3">
                        <i className="bi bi-calculator me-1"></i>
                        Distribución del Pago
                      </h4>
                      <div className="grid grid-cols-1 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Efectivo
                          </label>
                          <input
                            type="number"
                            min="0"
                            max={paymentEditingOrder.total || 0}
                            step="0.01"
                            value={editPaymentData.cashAmount}
                            onChange={(e) => {
                              const cashAmount = parseFloat(e.target.value) || 0
                              const transferAmount = (paymentEditingOrder.total || 0) - cashAmount
                              setEditPaymentData({
                                ...editPaymentData,
                                cashAmount,
                                transferAmount: Math.max(0, transferAmount)
                              })
                            }}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-red-500 focus:border-red-500"
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Transferencia
                          </label>
                          <input
                            type="number"
                            min="0"
                            max={paymentEditingOrder.total || 0}
                            step="0.01"
                            value={editPaymentData.transferAmount}
                            onChange={(e) => {
                              const transferAmount = parseFloat(e.target.value) || 0
                              const cashAmount = (paymentEditingOrder.total || 0) - transferAmount
                              setEditPaymentData({
                                ...editPaymentData,
                                transferAmount,
                                cashAmount: Math.max(0, cashAmount)
                              })
                            }}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-red-500 focus:border-red-500"
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      <div className="mt-2 text-sm text-gray-600">
                        Total: ${((editPaymentData.cashAmount || 0) + (editPaymentData.transferAmount || 0)).toFixed(2)} / ${(paymentEditingOrder.total || 0).toFixed(2)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Botones de acción */}
                <div className="flex space-x-3">
                  <button
                    onClick={handleSavePaymentEdit}
                    disabled={editPaymentData.method === 'mixed' &&
                      ((editPaymentData.cashAmount || 0) + (editPaymentData.transferAmount || 0)) !== (paymentEditingOrder.total || 0)
                    }
                    className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    <i className="bi bi-check-lg me-2"></i>
                    Guardar Cambios
                  </button>
                  <button
                    onClick={() => setShowEditPaymentModal(false)}
                    className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div >
            </div >
          </div >
        )
        }



        {/* Botón flotante para crear pedido - Solo visible en pedidos */}
        {activeTab === 'orders' && (
          <>
            <button
              onClick={() => {
                setManualSidebarMode('create')
                setEditingOrderForSidebar(null)
                setShowManualOrderModal(true)
              }}
              className="fixed bottom-4 right-4 bg-red-600 hover:bg-red-700 text-white rounded-full w-12 h-12 shadow-lg transition-colors z-50 flex items-center justify-center"
              title="Crear Pedido"
            >
              <i className="bi bi-plus-lg text-lg"></i>
            </button>

            <ManualOrderSidebar
              isOpen={showManualOrderModal}
              onClose={() => setShowManualOrderModal(false)}
              business={business}
              products={products}
              onOrderCreated={loadOrders}
              mode={manualSidebarMode}
              editOrder={editingOrderForSidebar || undefined}
              onOrderUpdated={loadOrders}
            />
          </>
        )}

        {/* Modal de Previsualización de Comprobante con Validación */}
        {showReceiptPreviewModal && paymentEditingOrder?.payment?.receiptImageUrl && (
          <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[70] p-4">
            <div className="relative max-w-4xl w-full h-full flex flex-col items-center justify-center">
              {/* Botón cerrar */}
              <button
                onClick={() => setShowReceiptPreviewModal(false)}
                className="absolute -top-1 right-0 text-white text-4xl p-4 hover:text-gray-300 transition-colors z-10"
              >
                ×
              </button>

              <div className="w-full h-full flex flex-col bg-white rounded-2xl overflow-hidden shadow-2xl">
                {/* Header info */}
                <div className="p-4 border-b flex items-center justify-between bg-gray-50">
                  <div>
                    <h3 className="font-bold text-gray-900">Comprobante de Pago</h3>
                    <p className="text-sm text-gray-600">
                      Cliente: {paymentEditingOrder.customer?.name} - Total: ${(paymentEditingOrder.total || 0).toFixed(2)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRejectPayment(paymentEditingOrder.id)}
                      className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-bold text-sm flex items-center gap-2"
                    >
                      <i className="bi bi-x-circle"></i>
                      Rechazar
                    </button>
                    <button
                      onClick={() => handleValidatePayment(paymentEditingOrder.id)}
                      className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-200"
                    >
                      <i className="bi bi-check-circle"></i>
                      Validar
                    </button>
                  </div>
                </div>

                {/* Imagen */}
                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-gray-200">
                  <img
                    src={paymentEditingOrder.payment.receiptImageUrl}
                    alt="Comprobante completo"
                    className="max-w-full max-h-full object-contain shadow-lg"
                  />
                </div>

                {/* Footer contextual */}
                <div className="p-3 bg-gray-50 text-center border-t">
                  <p className="text-xs text-gray-500 italic">
                    Al validar, el estado del pago cambiará automáticamente a "Pagado"
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div >
    </div >
  )
}