'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getBusiness, getProductsByBusiness, getOrdersByBusiness, updateOrderStatus, updateProduct, deleteProduct, getBusinessesByOwner, uploadImage, updateBusiness, addBusinessAdministrator, removeBusinessAdministrator, updateAdministratorPermissions, getUserBusinessAccess, getBusinessCategories, addCategoryToBusiness, searchClientByPhone, getClientLocations, createOrder, getDeliveriesByStatus, createClient, updateOrder, deleteOrder, createClientLocation } from '@/lib/database'
import { Business, Product, Order, ProductVariant, ClientLocation } from '@/types'
import { auth, db } from '@/lib/firebase'
import { doc, updateDoc, Timestamp } from 'firebase/firestore'
import { useBusinessAuth } from '@/contexts/BusinessAuthContext'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import ManualOrderSidebar from '@/components/ManualOrderSidebar'

export default function BusinessDashboard() {
  const router = useRouter()
  const { user, businessId, ownerId, isAuthenticated, logout, setBusinessId } = useBusinessAuth()
  const { permission, requestPermission, showNotification, isSupported, isIOS, needsUserAction } = usePushNotifications()
  const [business, setBusiness] = useState<Business | null>(null)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [previousOrdersCount, setPreviousOrdersCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'products' | 'orders' | 'profile' | 'admins'>('orders')
  const [showManualOrderModal, setShowManualOrderModal] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false) // Cerrado por defecto
  const [ordersSubTab, setOrdersSubTab] = useState<'today' | 'history'>('today') // Nueva pestaña para pedidos
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(businessId)
  const [userRole, setUserRole] = useState<'owner' | 'admin' | 'manager' | null>(null) // Nuevo estado
  const [showBusinessDropdown, setShowBusinessDropdown] = useState(false)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [editedBusiness, setEditedBusiness] = useState<Business | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  
  // Estados para el modal de edición de productos
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [editFormData, setEditFormData] = useState({
    name: '',
    description: '',
    price: '',
    category: '',
    isAvailable: true,
    image: null as File | null
  })
  const [editVariants, setEditVariants] = useState<ProductVariant[]>([])
  const [editCurrentVariant, setEditCurrentVariant] = useState({
    name: '',
    description: '',
    price: ''
  })
  const [businessCategories, setBusinessCategories] = useState<string[]>([])
  const [newCategory, setNewCategory] = useState('')
  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false)
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [uploadingProfile, setUploadingProfile] = useState(false)
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

  // Estados para editar órdenes
  const [showEditOrderModal, setShowEditOrderModal] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [editOrderData, setEditOrderData] = useState({
    customerName: '',
    customerPhone: '',
    deliveryType: '' as '' | 'delivery' | 'pickup',
    references: '',
    timingType: 'immediate' as 'immediate' | 'scheduled',
    scheduledDate: '',
    scheduledTime: '',
    paymentMethod: 'cash' as 'cash' | 'transfer' | 'mixed',
    selectedBank: '',
    paymentStatus: 'pending' as 'pending' | 'validating' | 'paid',
    cashAmount: 0,
    transferAmount: 0,
    total: 0,
    status: 'pending' as Order['status']
  })
  const [updatingOrder, setUpdatingOrder] = useState(false)

  // Estados para modal de detalles del pedido
  const [showOrderDetailsModal, setShowOrderDetailsModal] = useState(false)
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<Order | null>(null)
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false)
  const [paymentEditingOrder, setPaymentEditingOrder] = useState<Order | null>(null)
  const [editPaymentData, setEditPaymentData] = useState({
    method: 'cash' as 'cash' | 'transfer' | 'mixed',
    cashAmount: 0,
    transferAmount: 0
  })

  // Estados para historial agrupado por fecha
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set())

  // Estados para categorías colapsadas en pedidos de hoy
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set(['delivered']))

  // Protección de ruta - redirigir si no está autenticado
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/business/login');
    }
  }, [isAuthenticated, router]);

  // Cleanup del timeout al desmontar
  useEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  }, [searchTimeout]);

  useEffect(() => {
    if (typeof window === 'undefined' || !user || !isAuthenticated) return;
    
    const loadBusinesses = async () => {
      try {
        // Obtener acceso completo del usuario (propietario o administrador)
        const businessAccess = await getUserBusinessAccess(
          user.email || '', 
          user.uid
        );
        
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
        const uniqueBusinesses = allUserBusinesses.filter((business, index, self) =>
          index === self.findIndex(b => b.id === business.id)
        );
        
        setBusinesses(uniqueBusinesses);
        
        // Seleccionar tienda (preferencia: del contexto > primera propia > primera administrada)
        let businessToSelect = null;
        
        if (businessId) {
          businessToSelect = uniqueBusinesses.find(b => b.id === businessId);
        }
        
        if (!businessToSelect) {
          // Preferir tiendas propias sobre administradas
          if (businessAccess.ownedBusinesses.length > 0) {
            businessToSelect = businessAccess.ownedBusinesses[0];
          } else {
            businessToSelect = businessAccess.adminBusinesses[0];
          }
        }
        
        if (businessToSelect) {
          setSelectedBusinessId(businessToSelect.id);
          setBusiness(businessToSelect);
          
          // Actualizar el contexto si es diferente
          if (businessToSelect.id !== businessId) {
            setBusinessId(businessToSelect.id);
          }
          
          // Determinar el rol del usuario en esta tienda
          const isOwner = businessAccess.ownedBusinesses.some(b => b.id === businessToSelect.id);
          if (isOwner) {
            setUserRole('owner');
          } else {
            // Buscar el rol como administrador
            const adminRole = businessToSelect.administrators?.find(
              admin => admin.email === user.email
            );
            setUserRole(adminRole?.role || 'admin');
          }
        }
        
      } catch (error) {
        router.push('/business/login');
      } finally {
        setLoading(false);
      }
    };

    loadBusinesses();
  }, [router, user, businessId, isAuthenticated, logout, setBusinessId]);

  // Cargar datos específicos cuando se selecciona una tienda
  useEffect(() => {
    if (!selectedBusinessId) return;

    const loadBusinessData = async () => {
      try {
        // Cargar productos
        const productsData = await getProductsByBusiness(selectedBusinessId);
        setProducts(productsData);

        // Cargar categorías del negocio
        const categoriesData = await getBusinessCategories(selectedBusinessId);
        setBusinessCategories(categoriesData);

        // Cargar órdenes
        const ordersData = await getOrdersByBusiness(selectedBusinessId);
        
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

        // Inicializar fechas colapsadas para el historial
        const { pastOrders } = categorizeOrdersForData(ordersData);
        const groupedPastOrders = groupOrdersByDate(pastOrders);
        const allDates = groupedPastOrders.map(({ date }) => date);
        setCollapsedDates(new Set(allDates)); // Colapsar todas las fechas por defecto

        // Actualizar localStorage
        localStorage.setItem('businessId', selectedBusinessId);
      } catch (error) {
        // Error loading business data
      }
    };

    loadBusinessData();
  }, [selectedBusinessId]);

  // Función para recargar solo las órdenes
  const loadOrders = async () => {
    if (!selectedBusinessId) return;
    try {
      const ordersData = await getOrdersByBusiness(selectedBusinessId);
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
      try {
        const deliveries = await getDeliveriesByStatus('activo')
        setAvailableDeliveries(deliveries)
      } catch (error) {
        // Error loading deliveries (getDeliveriesByStatus ya devuelve [] en caso de fallo)
      }
    }

    loadDeliveries()
  }, [])

  // Efecto para recargar pedidos periódicamente y detectar nuevos
  useEffect(() => {
    if (!selectedBusinessId) return

    const interval = setInterval(async () => {
      try {
        const ordersData = await getOrdersByBusiness(selectedBusinessId);
        
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
    setEditingOrder(order)
    setEditOrderData({
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      deliveryType: order.delivery.type,
      references: order.delivery.references || '',
      timingType: order.timing.type,
      scheduledDate: order.timing.scheduledDate ? (() => {
        try {
          let date: Date;
          
          if (order.timing.scheduledDate instanceof Date) {
            if (isNaN(order.timing.scheduledDate.getTime())) {
              return '';
            }
            date = order.timing.scheduledDate;
          } else if (order.timing.scheduledDate && typeof order.timing.scheduledDate === 'object') {
            const timestampObj = order.timing.scheduledDate as any;
            if (typeof timestampObj.seconds === 'number' && typeof timestampObj.nanoseconds === 'number') {
              // Firebase Timestamp con seconds y nanoseconds
              const milliseconds = timestampObj.seconds * 1000 + Math.floor(timestampObj.nanoseconds / 1000000);
              date = new Date(milliseconds);
            } else if ('toDate' in timestampObj && typeof timestampObj.toDate === 'function') {
              // Firebase Timestamp con método toDate
              date = timestampObj.toDate();
            } else {
              date = new Date(timestampObj);
            }
          } else {
            date = new Date(order.timing.scheduledDate as any);
          }
          
          if (isNaN(date.getTime())) {
            return '';
          }
          
          // Formatear fecha para input type="date" (YYYY-MM-DD)
          return formatDateForInput(date);
        } catch (error) {
          console.error('Error parsing scheduledDate:', error, order.timing.scheduledDate);
          return '';
        }
      })() : '',
      scheduledTime: order.timing.scheduledTime || '',
      paymentMethod: order.payment.method,
      selectedBank: order.payment.selectedBank || '',
      paymentStatus: order.payment.paymentStatus || 'pending',
      cashAmount: (order.payment as any)?.cashAmount || 0,
      transferAmount: (order.payment as any)?.transferAmount || 0,
      total: order.total,
      status: order.status
    })
    setShowEditOrderModal(true)
  }

  const handleUpdateOrder = async () => {
    if (!editingOrder || !editOrderData.deliveryType) return
    
    setUpdatingOrder(true)
    try {
      const updatedOrderData = {
        customer: {
          name: editOrderData.customerName,
          phone: editOrderData.customerPhone
        },
        delivery: {
          type: editOrderData.deliveryType as 'delivery' | 'pickup',
          references: editOrderData.references,
          mapLocation: editingOrder.delivery.mapLocation,
          assignedDelivery: editingOrder.delivery.assignedDelivery
        },
        timing: {
          type: editOrderData.timingType,
          scheduledDate: editOrderData.timingType === 'immediate' 
            ? Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000))
            : (() => {
                if (editOrderData.scheduledDate && editOrderData.scheduledTime) {
                  // Crear fecha en zona horaria local (Ecuador)
                  const [year, month, day] = editOrderData.scheduledDate.split('-').map(Number);
                  const [hours, minutes] = editOrderData.scheduledTime.split(':').map(Number);
                  const programmedDate = new Date(year, month - 1, day, hours, minutes);
                  
                  if (isNaN(programmedDate.getTime())) {
                    throw new Error('Fecha programada inválida');
                  }
                  
                  return Timestamp.fromDate(programmedDate);
                }
                return undefined;
              })(),
          scheduledTime: editOrderData.timingType === 'immediate'
            ? new Date(Date.now() + 30 * 60 * 1000).toTimeString().slice(0, 5)
            : editOrderData.scheduledTime
        },
        payment: {
          method: editOrderData.paymentMethod,
          selectedBank: editOrderData.selectedBank,
          paymentStatus: editOrderData.paymentStatus,
          bankAccount: editingOrder.payment.bankAccount,
          ...(editOrderData.paymentMethod === 'mixed' && {
            cashAmount: editOrderData.cashAmount || 0,
            transferAmount: editOrderData.transferAmount || 0
          })
        },
        total: editOrderData.total,
        status: editOrderData.status
      }

      await updateOrder(editingOrder.id, updatedOrderData)
      
      // Actualizar estado local
      setOrders(orders.map(order => 
        order.id === editingOrder.id ? { ...order, ...updatedOrderData } as Order : order
      ))
      
      setShowEditOrderModal(false)
      setEditingOrder(null)
    } catch (error) {
      alert('Error al actualizar la orden')
    } finally {
      setUpdatingOrder(false)
    }
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
      transferAmount: (order.payment as any)?.transferAmount || 0
    })
    setShowEditPaymentModal(true)
  }

  const handleSavePaymentEdit = async () => {
    if (!paymentEditingOrder) return

    try {
      let paymentUpdate: any = {
        method: editPaymentData.method,
        paymentStatus: 'pending'
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
            ...order.payment, 
            paymentStatus: 'paid' 
          } 
        } : order
      ))
    } catch (error) {
      alert('Error al actualizar el estado de pago')
    }
  }

  const toggleDateCollapse = (dateKey: string) => {
    const newCollapsed = new Set(collapsedDates)
    if (newCollapsed.has(dateKey)) {
      newCollapsed.delete(dateKey)
    } else {
      newCollapsed.add(dateKey)
    }
    setCollapsedDates(newCollapsed)
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

  // Función unificada para enviar mensajes de WhatsApp
  const handleSendWhatsApp = (order: Order) => {
    let phone = ''
    let title = ''
    
    if (order.delivery.type === 'delivery') {
      // Para delivery, enviar al delivery asignado
      const assignedDeliveryId = order.delivery?.assignedDelivery || (order.delivery as any)?.selectedDelivery
      if (!assignedDeliveryId) {
        alert('Este pedido no tiene un delivery asignado')
        return
      }

      const delivery = availableDeliveries.find(d => d.id === assignedDeliveryId)
      if (!delivery) {
        alert('No se encontró la información del delivery')
        return
      }
      
      phone = delivery.celular
      title = 'Enviar mensaje de WhatsApp al delivery'
    } else {
      // Para retiro, enviar al número de la tienda
      if (!business?.phone) {
        alert('No se encontró el número de teléfono de la tienda')
        return
      }
      
      phone = business.phone
      title = 'Enviar mensaje de WhatsApp a la tienda'
    }

    // Construir el mensaje de WhatsApp
    const customerName = order.customer?.name || 'Cliente sin nombre'
    const customerPhone = order.customer?.phone || 'Sin teléfono'
    const references = order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia'
    
    // Crear enlace de Google Maps si hay coordenadas (solo para delivery)
    let locationLink = ''
    if (order.delivery.type === 'delivery') {
      if (order.delivery?.latlong) {
        // Limpiar espacios en blanco de las coordenadas
        const cleanCoords = order.delivery.latlong.replace(/\s+/g, '')
        locationLink = `https://www.google.com/maps/place/${cleanCoords}`
      } else if (order.delivery?.mapLocation) {
        locationLink = `https://www.google.com/maps/place/${order.delivery.mapLocation.lat},${order.delivery.mapLocation.lng}`
      }
    }

    // Construir lista de productos
    const productsList = order.items?.map((item: any) => 
      `${item.quantity} de ${item.variant || item.name || item.product?.name || 'Producto'}`
    ).join('\n') || 'Sin productos'

    // Calcular totales
    const deliveryCost = order.delivery.type === 'delivery' ? (order.delivery?.deliveryCost || 1) : 0
    const subtotal = order.total - deliveryCost
    const paymentMethod = order.payment?.method === 'cash' ? 'Efectivo' : 
                         order.payment?.method === 'transfer' ? 'Transferencia' :
                         order.payment?.method === 'mixed' ? 'Pago Mixto' : 'Sin especificar'
    
    // Construir mensaje
    let message = `*Datos del cliente*\n`
    message += `Cliente: ${customerName}\n`
    message += `Celular: ${customerPhone}\n\n`
    
    if (order.delivery.type === 'delivery') {
      message += `*Lugar de entrega*\n`
      message += `Referencias: ${references}\n`
      if (locationLink) {
        message += `Ubicación: ${locationLink}\n\n`
      } else {
        message += `\n`
      }
    } else {
      message += `*Tipo de entrega*\n`
      message += `🏪 Retiro en tienda\n\n`
    }
    
    message += `*Detalle del pedido*\n`
    message += `${productsList}\n\n`
    
    message += `*Detalles del pago*\n`
    message += `Valor del pedido: $${subtotal.toFixed(2)}\n`
    
    if (order.delivery.type === 'delivery') {
      message += `Envío: $${deliveryCost.toFixed(2)}\n\n`
    }
    
    message += `Forma de pago: ${paymentMethod}\n`
    
    // Mostrar detalles de pago mixto si aplica
    if (order.payment?.method === 'mixed') {
      const payment = order.payment as any
      if (payment.cashAmount && payment.transferAmount) {
        message += `- Efectivo: $${payment.cashAmount.toFixed(2)}\n`
        message += `- Transferencia: $${payment.transferAmount.toFixed(2)}\n\n`
      }
    }
    
    // Solo mostrar "Total a cobrar" si es efectivo o pago mixto
    if (order.payment?.method === 'cash' || order.payment?.method === 'mixed') {
      message += `Total a cobrar: $${order.total.toFixed(2)}`
    }

    // Limpiar el número de teléfono (quitar espacios, guiones, etc.)
    const cleanPhone = phone.replace(/\D/g, '')
    
    // Crear enlace de WhatsApp
    const whatsappUrl = `https://api.whatsapp.com/send?phone=593${cleanPhone.startsWith('0') ? cleanPhone.slice(1) : cleanPhone}&text=${encodeURIComponent(message)}`
    
    // Abrir WhatsApp Web
    window.open(whatsappUrl, '_blank')
  }

  const handleToggleAvailability = async (productId: string, currentAvailability: boolean) => {
    try {
      await updateProduct(productId, { isAvailable: !currentAvailability })
      setProducts(prev => prev.map(product => 
        product.id === productId ? { ...product, isAvailable: !currentAvailability } : product
      ))
    } catch (error) {
      // Error updating product availability
    }
  }

  const handleDeleteProduct = async (productId: string) => {
    if (window.confirm('¿Estás seguro de que quieres eliminar este producto?')) {
      try {
        await deleteProduct(productId)
        setProducts(prev => prev.filter(product => product.id !== productId))
      } catch (error) {
        // Error deleting product
      }
    }
  }

  // Funciones para editar productos
  const handleEditProduct = (product: Product) => {
    setEditingProduct(product)
    setEditFormData({
      name: product.name,
      description: product.description,
      price: product.price.toString(),
      category: product.category,
      isAvailable: product.isAvailable,
      image: null
    })
    setEditVariants(product.variants || [])
    setShowEditModal(true)
  }

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingProduct || !selectedBusinessId) return

    // Validar formulario
    const newErrors: Record<string, string> = {}
    if (!editFormData.name.trim()) newErrors.name = 'El nombre es requerido'
    if (!editFormData.description.trim()) newErrors.description = 'La descripción es requerida'
    if (!editFormData.price || isNaN(Number(editFormData.price)) || Number(editFormData.price) <= 0) {
      newErrors.price = 'El precio debe ser un número válido mayor a 0'
    }
    if (!editFormData.category) newErrors.category = 'La categoría es requerida'

    if (Object.keys(newErrors).length > 0) {
      setEditErrors(newErrors)
      return
    }

    setUploading(true)
    try {
      let imageUrl = editingProduct.image // Mantener imagen actual por defecto

      // Subir nueva imagen si se seleccionó una
      if (editFormData.image) {
        const timestamp = Date.now()
        const path = `products/${timestamp}_${editFormData.image.name}`
        imageUrl = await uploadImage(editFormData.image, path)
      }

      const updatedData = {
        name: editFormData.name,
        description: editFormData.description,
        price: Number(editFormData.price),
        category: editFormData.category,
        image: imageUrl,
        variants: editVariants.length > 0 ? editVariants : undefined,
        isAvailable: editFormData.isAvailable,
        updatedAt: new Date()
      }

      await updateProduct(editingProduct.id, updatedData)
      
      setProducts(prev => prev.map(product => 
        product.id === editingProduct.id 
          ? { ...product, ...updatedData }
          : product
      ))

      handleCloseEditModal()
      alert('Producto actualizado exitosamente')
    } catch (error) {
      setEditErrors({ submit: 'Error al actualizar el producto' })
    } finally {
      setUploading(false)
    }
  }

  const handleCloseEditModal = () => {
    setShowEditModal(false)
    setEditingProduct(null)
    setEditFormData({
      name: '',
      description: '',
      price: '',
      category: '',
      isAvailable: true,
      image: null
    })
    setEditVariants([])
    setEditCurrentVariant({ name: '', description: '', price: '' })
    setEditErrors({})
    setShowNewCategoryForm(false)
    setNewCategory('')
  }

  // Funciones para manejar input del formulario de edición
  const handleEditInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setEditFormData(prev => ({ ...prev, [name]: value }))
    // Limpiar errores al escribir
    if (editErrors[name]) {
      setEditErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const handleEditImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setEditFormData(prev => ({ ...prev, image: file }))
    }
  }

  // Funciones para manejar variantes en edición
  const handleEditVariantChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setEditCurrentVariant(prev => ({ ...prev, [name]: value }))
  }

  const addEditVariant = () => {
    if (!editCurrentVariant.name.trim()) {
      alert('El nombre de la variante es requerido')
      return
    }

    const price = editCurrentVariant.price ? Number(editCurrentVariant.price) : Number(editFormData.price)
    
    if (isNaN(price) || price <= 0) {
      alert('El precio debe ser un número válido mayor a 0')
      return
    }

    const newVariant: ProductVariant = {
      id: Date.now().toString(),
      name: editCurrentVariant.name,
      description: editCurrentVariant.description || '',
      price: price,
      isAvailable: true
    }

    setEditVariants(prev => [...prev, newVariant])
    setEditCurrentVariant({ name: '', description: '', price: '' })
  }

  const removeEditVariant = (variantId: string) => {
    setEditVariants(prev => prev.filter(v => v.id !== variantId))
  }

  // Función para agregar nueva categoría en edición
  const addNewEditCategory = async () => {
    if (!newCategory.trim() || !selectedBusinessId) {
      alert('El nombre de la categoría es requerido')
      return
    }

    try {
      await addCategoryToBusiness(selectedBusinessId, newCategory.trim())
      setBusinessCategories(prev => [...prev, newCategory.trim()])
      setEditFormData(prev => ({ ...prev, category: newCategory.trim() }))
      setShowNewCategoryForm(false)
      setNewCategory('')
    } catch (error) {
      alert('Error al agregar la categoría')
    }
  }

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
      
      // Actualizar en la lista de negocios
      setBusinesses(prev => prev.map(b => 
        b.id === business.id ? updatedBusiness : b
      ));
      
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
      
      // Actualizar en la lista de negocios
      setBusinesses(prev => prev.map(b => 
        b.id === business.id ? updatedBusiness : b
      ));
      
    } catch (error) {
      alert('Error al subir la imagen de perfil. Inténtalo de nuevo.');
    } finally {
      setUploadingProfile(false);
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
            <table className="w-full">
              <tbody className="bg-white">
                {groupedOrders.map(({ status, orders: statusOrders }, groupIndex) => (
                  <React.Fragment key={`group-${status}`}>
                    {/* Título del estado - ahora clickeable */}
                    <tr key={`title-${status}`} className="bg-gray-50">
                      <td colSpan={9} className="px-4 py-3 border-b border-gray-200">
                        <button
                          onClick={() => toggleCategoryCollapse(status)}
                          className="w-full text-left hover:bg-gray-100 rounded px-2 py-1 transition-colors"
                        >
                          <h3 className="text-md font-semibold text-gray-900 flex items-center">
                            <span className="mr-2">
                              {status === 'pending' && '🕐'}
                              {status === 'confirmed' && '✅'}
                              {status === 'preparing' && '👨‍🍳'}
                              {status === 'ready' && '🔔'}
                              {status === 'delivered' && '📦'}
                              {status === 'cancelled' && '❌'}
                            </span>
                            {getStatusDisplayName(status)}
                            <span className="ml-2 bg-gray-200 text-gray-700 px-2 py-1 rounded-full text-sm">
                              {statusOrders.length}
                            </span>
                            <span className="ml-auto">
                              <i className={`bi ${collapsedCategories.has(status) ? 'bi-chevron-down' : 'bi-chevron-up'} text-gray-400`}></i>
                            </span>
                          </h3>
                        </button>
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

    return (
      <tr className={`hover:bg-gray-50 transition-colors ${borderClass}`}>
        <td 
          className="px-3 py-2 whitespace-nowrap text-sm cursor-pointer"
          onClick={() => handleShowOrderDetails(order)}
        >
          {isToday ? (
            <span className={`font-medium ${isOrderUpcoming(order) ? 'text-orange-600' : 'text-gray-900'}`}>
              <i className="bi bi-clock me-1"></i>
              {formatTime(getOrderDateTime(order))}
            </span>
          ) : (
            <span className="text-gray-900">
              {formatDate(getOrderDateTime(order))}
            </span>
          )}
        </td>
        {/* Nueva columna de acciones principales */}
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex space-x-1">
            {isToday && order.status !== 'delivered' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleMarkAsDelivered(order.id)
                }}
                className="text-green-600 hover:text-green-800 p-1 rounded hover:bg-green-50"
                title="Marcar como entregado"
              >
                <i className="bi bi-check-lg text-lg"></i>
              </button>
            )}
            {isToday && (
              (order.delivery?.type === 'delivery' && (order.delivery?.assignedDelivery || (order.delivery as any)?.selectedDelivery)) ||
              (order.delivery?.type === 'pickup' && business?.phone)
            ) && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleSendWhatsApp(order)
                }}
                className="text-green-600 hover:text-green-800 p-1 rounded hover:bg-green-50"
                title={order.delivery?.type === 'delivery' ? 'Enviar mensaje de WhatsApp al delivery' : 'Enviar mensaje de WhatsApp a la tienda'}
              >
                <i className="bi bi-whatsapp text-lg"></i>
              </button>
            )}
          </div>
        </td>
        <td 
          className="px-3 py-2 whitespace-nowrap cursor-pointer"
          onClick={() => handleShowOrderDetails(order)}
        >
          <div>
            <div className="text-sm font-medium text-gray-900">
              {order.customer?.name || 'Cliente sin nombre'}
            </div>
            <div className="text-xs text-gray-500">
              {order.delivery?.type === 'delivery' ? (
                <>
                  <i className="bi bi-geo-alt me-1"></i>
                  <span
                    className="inline-block max-w-[160px] sm:max-w-[200px] md:max-w-[260px] truncate align-bottom"
                    title={order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia'}
                  >
                    {order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia'}
                  </span>
                </>
              ) : (
                <>
                  <i className="bi bi-shop me-1"></i>
                  <span className="font-medium text-blue-600">Retiro en tienda</span>
                </>
              )}
            </div>
          </div>
        </td>
        <td 
          className="px-3 py-2 cursor-pointer"
          onClick={() => handleShowOrderDetails(order)}
        >
          <div className="text-sm text-gray-900">
            {order.items?.slice(0, 2).map((item: any, index) => (
              <div key={index} className="truncate">
                {item.quantity}x {item.variant || item.name || item.product?.name || 'Producto'}
              </div>
            ))}
            {order.items && order.items.length > 2 && (
              <div className="text-xs text-gray-500">
                +{order.items.length - 2} más...
              </div>
            )}
          </div>
        </td>
        <td 
          className="px-3 py-2 whitespace-nowrap cursor-pointer"
          onClick={() => handleShowOrderDetails(order)}
        >
          <span className="text-lg font-bold text-emerald-600">
            ${(order.total || (order as any).totalAmount || 0).toFixed(2)}
          </span>
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <select
            value={order.status}
            onChange={(e) => handleStatusChange(order.id, e.target.value as Order['status'])}
            className={`text-xs font-medium px-3 py-1 rounded-full border-none ${getStatusColor(order.status)} focus:ring-2 focus:ring-red-500`}
          >
            <option value="pending">🕐 Pendiente</option>
            <option value="confirmed">✅ Confirmado</option>
            <option value="preparing">👨‍🍳 Preparando</option>
            <option value="ready">🔔 Listo</option>
            <option value="delivered">📦 Entregado</option>
            <option value="cancelled">❌ Cancelado</option>
          </select>
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex items-center space-x-2">
            {isToday ? (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleEditPayment(order)
                }}
                className={`text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity ${
                  order.payment?.method === 'cash' 
                    ? 'text-green-700 bg-green-100 hover:bg-green-200' 
                    : order.payment?.method === 'mixed'
                      ? 'text-yellow-700 bg-yellow-100 hover:bg-yellow-200'
                      : 'text-blue-700 bg-blue-100 hover:bg-blue-200'
                }`}
                title="Editar método de pago"
              >
                <i className={`bi ${
                  order.payment?.method === 'cash' 
                    ? 'bi-cash' 
                    : order.payment?.method === 'mixed'
                      ? 'bi-cash-coin'
                      : 'bi-credit-card'
                } me-1`}></i>
                {order.payment?.method === 'cash' 
                  ? 'Efectivo' 
                  : order.payment?.method === 'mixed'
                    ? 'Mixto'
                    : 'Transferencia'
                }
              </button>
            ) : (
              <span className={`text-xs px-2 py-1 rounded ${
                order.payment?.method === 'cash' 
                  ? 'text-green-700 bg-green-100' 
                  : order.payment?.method === 'mixed'
                    ? 'text-yellow-700 bg-yellow-100'
                    : 'text-blue-700 bg-blue-100'
              }`}>
                <i className={`bi ${
                  order.payment?.method === 'cash' 
                    ? 'bi-cash' 
                    : order.payment?.method === 'mixed'
                      ? 'bi-cash-coin'
                      : 'bi-credit-card'
                } me-1`}></i>
                {order.payment?.method === 'cash' 
                  ? 'Efectivo' 
                  : order.payment?.method === 'mixed'
                    ? 'Mixto'
                    : 'Transferencia'
                }
              </span>
            )}
            {isToday && order.payment?.method === 'transfer' && order.payment?.paymentStatus !== 'paid' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleMarkAsPaid(order.id)
                }}
                className="text-xs bg-green-600 text-white px-3 py-1 rounded-full hover:bg-green-700 transition-colors font-medium"
                title="Marcar como pagado"
              >
                <i className="bi bi-check-circle me-1"></i>
                Pagado
              </button>
            )}
          </div>
        </td>
        {isToday && order.delivery?.type === 'delivery' && (
          <td className="px-3 py-2 whitespace-nowrap">
            {(() => {
              const currentDeliveryId = order.delivery?.assignedDelivery || (order.delivery as any)?.selectedDelivery;
              const currentDelivery = availableDeliveries?.find(d => d.id === currentDeliveryId);
              
              return (
                <div className="relative">
                  <select
                    value={currentDeliveryId || ''}
                    onChange={(e) => handleDeliveryAssignment(order.id, e.target.value)}
                    className={`text-xs px-2 py-1 rounded-full border-0 font-medium transition-colors ${
                      currentDelivery 
                        ? 'bg-blue-100 text-blue-800' 
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <option value="">Sin asignar</option>
                    {availableDeliveries?.map((delivery) => (
                      <option key={delivery.id} value={delivery.id}>
                        {delivery.nombres}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })()}
          </td>
        )}
        {isToday && order.delivery?.type === 'pickup' && (
          <td className="px-3 py-2 whitespace-nowrap">
            <span className="text-xs text-gray-400 italic">
              N/A
            </span>
          </td>
        )}
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex space-x-1">
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleEditOrder(order)
              }}
              className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50"
              title="Editar orden"
            >
              <i className="bi bi-pencil text-sm"></i>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteOrder(order.id)
              }}
              className="text-red-600 hover:text-red-800 p-1 rounded hover:bg-red-50"
              title="Eliminar orden"
            >
              <i className="bi bi-trash text-sm"></i>
            </button>
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
        businessId: business.id,
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

      await createOrder(orderData as any);
      
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
        const ordersData = await getOrdersByBusiness(selectedBusinessId);
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-3 sm:py-4">
            <div className="flex items-center space-x-3">
              {/* Botón de menú móvil */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <i className="bi bi-list text-xl"></i>
              </button>
              
              <Link href="/" className="text-xl sm:text-2xl font-bold text-red-600">
                fuddi.shop
              </Link>
              <span className="hidden sm:inline text-gray-600">Dashboard</span>
            </div>
            
            <div className="flex items-center space-x-2 sm:space-x-4">
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
                    <i className={`bi bi-chevron-down text-gray-500 text-xs transition-transform ${
                      showBusinessDropdown ? 'rotate-180' : ''
                    }`}></i>
                  </div>
                  
                  {/* Solo flecha en móvil */}
                  <i className={`sm:hidden bi bi-chevron-down text-gray-500 text-xs transition-transform ${
                    showBusinessDropdown ? 'rotate-180' : ''
                  }`}></i>
                </button>

                {/* Dropdown */}
                {showBusinessDropdown && (
                  <div className="absolute right-0 mt-2 w-64 sm:w-72 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-10">
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
                          className={`w-full flex items-center space-x-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                            selectedBusinessId === biz.id ? 'bg-red-50 border-r-2 border-red-500' : ''
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
                              <div className="w-full h-full flex items-center justify-center">
                                <i className="bi bi-shop text-gray-400 text-sm"></i>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">{biz.name}</p>
                            <div className="flex items-center space-x-2">
                              <p className="text-sm text-gray-500 truncate">@{biz.username}</p>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                role === 'owner' 
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
                  </div>
                )}
              </div>

              <button
                onClick={handleLogout}
                className="bg-gray-100 text-gray-700 px-2 sm:px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm sm:text-base"
              >
                <i className="bi bi-box-arrow-right sm:me-2"></i>
                <span className="hidden sm:inline">Cerrar Sesión</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Layout con Sidebar */}
      <div className="flex h-screen">
        {/* Overlay solo en móvil */}
        {sidebarOpen && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
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
                className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${
                  activeTab === 'orders'
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
              
              <button
                onClick={() => {
                  setActiveTab('products')
                  setSidebarOpen(false)
                }}
                className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${
                  activeTab === 'products'
                    ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <i className="bi bi-box-seam me-3 text-lg"></i>
                <span className="font-medium">Productos</span>
                <span className="ml-auto bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-xs">
                  {products.length}
                </span>
              </button>
              
              <button
                onClick={() => {
                  setActiveTab('profile')
                  setSidebarOpen(false)
                }}
                className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${
                  activeTab === 'profile'
                    ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <i className="bi bi-shop me-3 text-lg"></i>
                <span className="font-medium">Perfil</span>
              </button>
              
              <button
                onClick={() => {
                  setActiveTab('admins')
                  setSidebarOpen(false)
                }}
                className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${
                  activeTab === 'admins'
                    ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <i className="bi bi-people me-3 text-lg"></i>
                <span className="font-medium">Administradores</span>
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

        {/* Main Content */}
        <div className={`flex-1 transition-all duration-300 ease-in-out overflow-y-auto ${sidebarOpen ? 'ml-64' : 'ml-0'}`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <div className="space-y-6">
            {/* Sub-pestañas para pedidos */}
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8">
                <button
                  onClick={() => setOrdersSubTab('today')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                    ordersSubTab === 'today'
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
                  className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                    ordersSubTab === 'history'
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
                                  <i className="bi bi-credit-card me-1"></i>
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
              <div>
                {(() => {
                  const { upcomingOrders, pastOrders } = categorizeOrders();
                  const groupedPastOrders = groupOrdersByDate(pastOrders.slice(0, 100)); // Limitar a 100 pedidos
                  
                  return (
                    <div className="space-y-8">
                      {/* Pedidos Próximos */}
                      {upcomingOrders.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-gray-900">
                              <i className="bi bi-clock me-2"></i>
                              Pedidos Próximos ({upcomingOrders.length})
                            </h2>
                          </div>
                          <OrdersTable orders={upcomingOrders} isToday={false} />
                        </div>
                      )}

                      {/* Historial de Pedidos Agrupado por Fecha */}
                      {groupedPastOrders.length > 0 ? (
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-gray-900">
                              <i className="bi bi-archive me-2"></i>
                              Historial de Pedidos ({pastOrders.length})
                            </h2>
                            {pastOrders.length > 100 && (
                              <span className="text-sm text-gray-500">
                                Mostrando los últimos 100 pedidos
                              </span>
                            )}
                          </div>
                          
                          <div className="space-y-4">
                            {groupedPastOrders.map(({ date, orders }) => {
                              const isCollapsed = collapsedDates.has(date);
                              return (
                                <div key={date} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                  {/* Header de fecha colapsable */}
                                  <button
                                    onClick={() => toggleDateCollapse(date)}
                                    className="w-full px-4 py-3 bg-gray-50 border-b border-gray-200 text-left hover:bg-gray-100 transition-colors"
                                  >
                                    <div className="flex items-center justify-between">
                                      <h3 className="text-lg font-semibold text-gray-900 capitalize">
                                        {date}
                                        <span className="ml-2 bg-gray-200 text-gray-700 px-2 py-1 rounded-full text-sm">
                                          {orders.length}
                                        </span>
                                      </h3>
                                      <div className="flex items-center">
                                        <span className="text-sm text-gray-500 mr-2">
                                          ${orders.reduce((sum, order) => sum + (order.total || 0), 0).toFixed(2)} total
                                        </span>
                                        <i className={`bi ${isCollapsed ? 'bi-chevron-down' : 'bi-chevron-up'} text-gray-400`}></i>
                                      </div>
                                    </div>
                                  </button>
                                  
                                  {/* Tabla de pedidos (colapsable) */}
                                  {!isCollapsed && (
                                    <div className="overflow-x-auto">
                                      <table className="w-full">
                                        <thead className="bg-gray-50">
                                          <tr>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                              Hora
                                            </th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                              Cliente
                                            </th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                              Productos
                                            </th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                              Total
                                            </th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                              Estado
                                            </th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                              Pago
                                            </th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                              Acciones
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                          {orders.map((order) => (
                                            <OrderRow key={order.id} order={order} isToday={false} />
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : upcomingOrders.length === 0 && (
                        <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
                          <div className="text-6xl mb-4">📋</div>
                          <h3 className="text-lg font-medium text-gray-900 mb-2">No hay pedidos en el historial</h3>
                          <p className="text-gray-500 text-sm">Los pedidos completados aparecerán aquí</p>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* Products Tab */}
        {activeTab === 'products' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                <i className="bi bi-box-seam me-2"></i>Mis Productos
              </h2>
              <Link
                href="/business/products/add"
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                <i className="bi bi-plus-lg me-2"></i>Agregar Producto
              </Link>
            </div>

            {products.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-200 rounded-full flex items-center justify-center">
                  <i className="bi bi-box-seam text-gray-400 text-2xl"></i>
                </div>
                <p className="text-gray-600 mb-4 text-lg">Aún no tienes productos registrados</p>
                <Link
                  href="/business/products/add"
                  className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors"
                >
                  <i className="bi bi-plus-lg me-2"></i>Agregar Primer Producto
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.map((product) => (
                  <div key={product.id} className="bg-white rounded-lg shadow-md overflow-hidden">
                    {/* Imagen o espacio gris */}
                    <div className="w-full h-48 bg-gray-200 flex items-center justify-center">
                      {product.image ? (
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <i className="bi bi-image text-gray-400 text-4xl"></i>
                      )}
                    </div>
                    
                    <div className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-semibold text-lg text-gray-900 flex-1">
                          {product.name}
                        </h3>
                        <div className="flex space-x-1 ml-2">
                          {/* Botón Editar */}
                          <button
                            onClick={() => handleEditProduct(product)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Editar producto"
                          >
                            <i className="bi bi-pencil text-sm"></i>
                          </button>
                          
                          {/* Botón Ocultar/Mostrar */}
                          <button
                            onClick={() => handleToggleAvailability(product.id, product.isAvailable)}
                            className={`p-1.5 rounded transition-colors ${
                              product.isAvailable
                                ? 'text-orange-600 hover:bg-orange-50'
                                : 'text-green-600 hover:bg-green-50'
                            }`}
                            title={product.isAvailable ? 'Ocultar producto' : 'Mostrar producto'}
                          >
                            <i className={`bi ${product.isAvailable ? 'bi-eye-slash' : 'bi-eye'} text-sm`}></i>
                          </button>
                          
                          {/* Botón Eliminar */}
                          <button
                            onClick={() => handleDeleteProduct(product.id)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Eliminar producto"
                          >
                            <i className="bi bi-trash text-sm"></i>
                          </button>
                        </div>
                      </div>
                      
                      <p className="text-gray-600 text-sm mb-3 line-clamp-2">{product.description}</p>
                      
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-red-600 font-bold text-xl">
                          ${product.price.toFixed(2)}
                        </span>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          product.isAvailable
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          <i className={`bi ${product.isAvailable ? 'bi-check-circle' : 'bi-x-circle'} me-1`}></i>
                          {product.isAvailable ? 'Disponible' : 'No disponible'}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                          <i className="bi bi-tag me-1"></i>{product.category}
                        </span>
                        
                        {/* Mostrar número de variantes si existen */}
                        {product.variants && product.variants.length > 0 && (
                          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                            <i className="bi bi-collection me-1"></i>{product.variants.length} variantes
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">
              <i className="bi bi-shop me-2"></i>Información de la Tienda
            </h2>
            
            {/* Imagen de Portada */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden mb-4 sm:mb-6">
              <div className="h-32 sm:h-48 bg-gradient-to-r from-red-400 to-red-600 relative">
                {business.coverImage ? (
                  <img
                    src={business.coverImage}
                    alt="Portada de la tienda"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center text-white">
                      <i className="bi bi-image text-2xl sm:text-4xl mb-1 sm:mb-2 opacity-70"></i>
                      <p className="text-xs sm:text-sm opacity-90">Imagen de portada</p>
                    </div>
                  </div>
                )}
                
                {/* Botón para subir portada */}
                <div className="absolute top-2 right-2 sm:top-4 sm:right-4">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleCoverImageUpload}
                    className="hidden"
                    id="cover-upload"
                  />
                  <label
                    htmlFor="cover-upload"
                    className="cursor-pointer bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all inline-flex items-center"
                  >
                    {uploadingCover ? (
                      <>
                        <i className="bi bi-arrow-clockwise animate-spin me-1"></i>
                        <span className="hidden sm:inline">Subiendo...</span>
                        <span className="sm:hidden">...</span>
                      </>
                    ) : (
                      <>
                        <i className="bi bi-camera me-1"></i>
                        <span className="hidden sm:inline">
                          {business.coverImage ? 'Cambiar Portada' : 'Subir Portada'}
                        </span>
                        <span className="sm:hidden">Portada</span>
                      </>
                    )}
                  </label>
                </div>
              </div>
              
              {/* Imagen de Perfil superpuesta */}
              <div className="relative px-4 sm:px-6 pb-4 sm:pb-6">
                <div className="flex items-end -mt-12 sm:-mt-16">
                  <div className="relative">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 bg-white rounded-full p-1 shadow-lg">
                      {business.image ? (
                        <img
                          src={business.image}
                          alt={business.name}
                          className="w-full h-full object-cover rounded-full"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-200 rounded-full flex items-center justify-center">
                          <i className="bi bi-shop text-gray-400 text-xl sm:text-2xl"></i>
                        </div>
                      )}
                    </div>
                    
                    {/* Botón para cambiar imagen de perfil */}
                    <div className="absolute -bottom-1 -right-1">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleProfileImageUpload}
                        className="hidden"
                        id="profile-upload"
                      />
                      <label
                        htmlFor="profile-upload"
                        className="cursor-pointer bg-red-600 text-white p-1 sm:p-1.5 rounded-full hover:bg-red-700 transition-colors inline-flex items-center justify-center"
                      >
                        {uploadingProfile ? (
                          <i className="bi bi-arrow-clockwise animate-spin text-xs"></i>
                        ) : (
                          <i className="bi bi-camera text-xs"></i>
                        )}
                      </label>
                    </div>
                  </div>
                  
                  <div className="ml-3 sm:ml-4 flex-1 min-w-0">
                    <h3 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{business.name}</h3>
                    <p className="text-sm sm:text-base text-gray-600 truncate">@{business.username}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Información de la Tienda */}
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              {!isEditingProfile ? (
                // Vista de solo lectura
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-shop me-2"></i>Nombre de la Tienda
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base">{business.name}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-at me-2"></i>Usuario
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base">@{business.username}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-envelope me-2"></i>Email
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base break-all">{business.email}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-telephone me-2"></i>Teléfono
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base">{business.phone}</p>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-tags me-2"></i>Categorías
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {business.categories && business.categories.length > 0 ? (
                          business.categories.map((category, index) => (
                            <span key={index} className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs">
                              {category}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-500 text-sm">Sin categorías</span>
                        )}
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-clock me-2"></i>Estado
                      </label>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        business.isActive 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        <i className={`bi ${business.isActive ? 'bi-check-circle' : 'bi-x-circle'} me-1`}></i>
                        {business.isActive ? 'Activa' : 'Inactiva'}
                      </span>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-geo-alt me-2"></i>Dirección
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base">{business.address}</p>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-card-text me-2"></i>Descripción
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base">{business.description}</p>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-building me-2"></i>Referencias de Ubicación
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base">{business.references || 'Sin referencias'}</p>
                    </div>
                  </div>
                  
                  <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200">
                    <button 
                      onClick={handleEditProfile}
                      className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm sm:text-base"
                    >
                      <i className="bi bi-pencil me-2"></i>
                      Editar Información
                    </button>
                  </div>
                </>
              ) : (
                // Vista de edición
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-shop me-2"></i>Nombre de la Tienda
                      </label>
                      <input
                        type="text"
                        value={editedBusiness?.name || ''}
                        onChange={(e) => handleBusinessFieldChange('name', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-at me-2"></i>Usuario
                      </label>
                      <input
                        type="text"
                        value={editedBusiness?.username || ''}
                        onChange={(e) => handleBusinessFieldChange('username', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-envelope me-2"></i>Email
                      </label>
                      <input
                        type="email"
                        value={editedBusiness?.email || ''}
                        onChange={(e) => handleBusinessFieldChange('email', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-telephone me-2"></i>Teléfono
                      </label>
                      <input
                        type="tel"
                        value={editedBusiness?.phone || ''}
                        onChange={(e) => handleBusinessFieldChange('phone', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-tags me-2"></i>Categorías (separadas por comas)
                      </label>
                      <input
                        type="text"
                        value={editedBusiness?.categories?.join(', ') || ''}
                        onChange={(e) => handleBusinessFieldChange('categories', e.target.value.split(',').map(c => c.trim()).filter(c => c))}
                        placeholder="Ej: Comida rápida, Pizza, Italiana"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-clock me-2"></i>Estado de la Tienda
                      </label>
                      <select
                        value={editedBusiness?.isActive ? 'true' : 'false'}
                        onChange={(e) => handleBusinessFieldChange('isActive', e.target.value === 'true')}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      >
                        <option value="true">Activa</option>
                        <option value="false">Inactiva</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-geo-alt me-2"></i>Dirección
                      </label>
                      <input
                        type="text"
                        value={editedBusiness?.address || ''}
                        onChange={(e) => handleBusinessFieldChange('address', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-card-text me-2"></i>Descripción
                      </label>
                      <textarea
                        value={editedBusiness?.description || ''}
                        onChange={(e) => handleBusinessFieldChange('description', e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-building me-2"></i>Referencias de Ubicación
                      </label>
                      <textarea
                        value={editedBusiness?.references || ''}
                        onChange={(e) => handleBusinessFieldChange('references', e.target.value)}
                        rows={2}
                        placeholder="Ej: Cerca del centro comercial, junto a la farmacia..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>
                    
                    {/* Horario de atención */}
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-clock-history me-2"></i>Horario de Atención
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((day) => {
                          const dayObj = editedBusiness?.schedule?.[day] || { open: '09:00', close: '18:00', isOpen: true };
                          const label = day.charAt(0).toUpperCase() + day.slice(1);
                          return (
                            <div key={day} className="flex items-center gap-2">
                              <div className="w-28">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-gray-700">{label}</span>
                                  <button type="button" onClick={() => toggleDayOpen(day)} className={`text-xs px-2 py-1 rounded ${dayObj.isOpen ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                    {dayObj.isOpen ? 'Abierto' : 'Cerrado'}
                                  </button>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <input type="time" value={dayObj.open} onChange={(e) => handleScheduleFieldChange(day, 'open', e.target.value)} className="w-24 px-2 py-1 border rounded text-sm" />
                                  <span className="text-xs text-gray-400">-</span>
                                  <input type="time" value={dayObj.close} onChange={(e) => handleScheduleFieldChange(day, 'close', e.target.value)} className="w-24 px-2 py-1 border rounded text-sm" />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200 flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
                    <button 
                      onClick={handleSaveProfile}
                      className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm sm:text-base"
                    >
                      <i className="bi bi-check-circle me-2"></i>
                      Guardar Cambios
                    </button>
                    <button 
                      onClick={handleCancelEdit}
                      className="w-full sm:w-auto bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm sm:text-base"
                    >
                      <i className="bi bi-x-circle me-2"></i>
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
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
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-screen overflow-y-auto">
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
                      className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
        </div>
      </div>



      {/* Modal de Edición de Producto */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-semibold text-gray-900">
                  <i className="bi bi-pencil me-2"></i>Editar Producto
                </h3>
                <button
                  onClick={handleCloseEditModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>

              <form onSubmit={handleUpdateProduct} className="space-y-6">
                {/* Categoría */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Categoría *
                  </label>
                  
                  {!showNewCategoryForm ? (
                    <div className="space-y-2">
                      <select
                        name="category"
                        value={editFormData.category}
                        onChange={handleEditInputChange}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                          editErrors.category ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                      >
                        <option value="">Selecciona una categoría</option>
                        {businessCategories.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      
                      <button
                        type="button"
                        onClick={() => setShowNewCategoryForm(true)}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        + Agregar nueva categoría
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 p-4 border border-gray-200 rounded-md bg-gray-50">
                      <h4 className="font-medium text-gray-900">Nueva Categoría</h4>
                      <input
                        type="text"
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        placeholder="Nombre de la categoría"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                      <div className="flex space-x-2">
                        <button
                          type="button"
                          onClick={addNewEditCategory}
                          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                        >
                          Agregar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewCategoryForm(false)
                            setNewCategory('')
                          }}
                          className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                  {editErrors.category && <p className="text-red-500 text-sm mt-1">{editErrors.category}</p>}
                </div>

                {/* Nombre del producto */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre del Producto *
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={editFormData.name}
                    onChange={handleEditInputChange}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      editErrors.name ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="Ej: Hamburguesa Clásica"
                    required
                  />
                  {editErrors.name && <p className="text-red-500 text-sm mt-1">{editErrors.name}</p>}
                </div>

                {/* Descripción */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Descripción *
                  </label>
                  <textarea
                    name="description"
                    rows={3}
                    value={editFormData.description}
                    onChange={handleEditInputChange}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      editErrors.description ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="Describe tu producto..."
                    required
                  />
                  {editErrors.description && <p className="text-red-500 text-sm mt-1">{editErrors.description}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Precio */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Precio Base *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name="price"
                        value={editFormData.price}
                        onChange={handleEditInputChange}
                        className={`w-full pl-8 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                          editErrors.price ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="0.00"
                        required
                      />
                    </div>
                    {editErrors.price && <p className="text-red-500 text-sm mt-1">{editErrors.price}</p>}
                  </div>

                  {/* Imagen */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Imagen del Producto
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleEditImageChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    {editingProduct?.image && (
                      <div className="mt-2">
                        <img 
                          src={editingProduct.image} 
                          alt="Imagen actual" 
                          className="w-16 h-16 object-cover rounded-md"
                        />
                        <p className="text-xs text-gray-500 mt-1">Imagen actual</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Variantes */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">Variantes del Producto</h3>
                    <span className="text-sm text-gray-500">Opcional</span>
                  </div>
                  
                  <div className="bg-gray-50 p-4 rounded-md mb-4">
                    <h4 className="font-medium text-gray-900 mb-3">Agregar Nueva Variante</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Nombre de la variante *
                        </label>
                        <input
                          type="text"
                          name="name"
                          value={editCurrentVariant.name}
                          onChange={handleEditVariantChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                          placeholder="Ej: Tamaño grande, Con queso extra"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Precio ($ - opcional)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          name="price"
                          value={editCurrentVariant.price}
                          onChange={handleEditVariantChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                          placeholder="Dejalo vacío para usar precio base"
                        />
                      </div>
                      
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={addEditVariant}
                          className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
                        >
                          Agregar Variante
                        </button>
                      </div>
                    </div>
                    
                    <div className="mt-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Descripción (opcional)
                      </label>
                      <input
                        type="text"
                        name="description"
                        value={editCurrentVariant.description}
                        onChange={handleEditVariantChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                        placeholder="Ej: Con salsa especial"
                      />
                    </div>
                  </div>
                  
                  {/* Lista de variantes */}
                  {editVariants.length > 0 && (
                    <div className="mb-4">
                      <h4 className="font-medium text-gray-900 mb-3">Variantes agregadas:</h4>
                      <div className="space-y-2">
                        {editVariants.map((variant) => (
                          <div key={variant.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-4">
                                <span className="font-medium text-gray-900">{variant.name}</span>
                                <span className="text-green-600 font-medium">${variant.price.toFixed(2)}</span>
                                {variant.description && (
                                  <span className="text-gray-500 text-sm">- {variant.description}</span>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeEditVariant(variant.id)}
                              className="text-red-600 hover:text-red-700 p-1"
                            >
                              <i className="bi bi-trash"></i>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Disponibilidad */}
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={editFormData.isAvailable}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, isAvailable: e.target.checked }))}
                      className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">Producto disponible</span>
                  </label>
                </div>

                {/* Errores */}
                {editErrors.submit && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-red-600 text-sm">{editErrors.submit}</p>
                  </div>
                )}

                {/* Botones */}
                <div className="flex space-x-3 pt-4">
                  <button
                    type="submit"
                    disabled={uploading}
                    className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {uploading ? (
                      <>
                        <i className="bi bi-arrow-clockwise animate-spin me-2"></i>
                        Guardando...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check-lg me-2"></i>
                        Guardar Cambios
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseEditModal}
                    disabled={uploading}
                    className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <span className={`ml-2 px-2 py-1 rounded text-sm ${
                      selectedOrderDetails.delivery?.type === 'delivery' 
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
                  <i className="bi bi-credit-card-fill me-2"></i>
                  Información de Pago
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <span className="text-sm font-medium text-gray-500">Método:</span>
                    <p className="text-gray-900">
                      {selectedOrderDetails.payment?.method === 'cash' ? 'Efectivo' : 'Transferencia'}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-500">Estado:</span>
                    <span className={`ml-1 px-2 py-1 rounded text-sm ${
                      selectedOrderDetails.payment?.paymentStatus === 'paid' 
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    handleEditOrder(selectedOrderDetails)
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
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
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
                        transferAmount: 0
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
                        transferAmount: 0
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
                        transferAmount: 0
                      })}
                      className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
                    />
                    <span className="ml-3 text-gray-700">
                      <i className="bi bi-cash-coin me-2 text-yellow-600"></i>
                      Mixto (Efectivo + Transferencia)
                    </span>
                  </label>
                </div>

                {/* Montos para pago mixto */}
                {editPaymentData.method === 'mixed' && (
                  <div className="mt-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                    <h4 className="text-sm font-medium text-gray-900 mb-3">
                      Distribución del Pago
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-red-500 focus:border-red-500"
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-red-500 focus:border-red-500"
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
                  className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
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
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edición de Orden */}
      {showEditOrderModal && editingOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-semibold text-gray-900">
                  <i className="bi bi-pencil me-2"></i>Editar Orden
                </h3>
                <button
                  onClick={() => setShowEditOrderModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleUpdateOrder(); }} className="space-y-6">
                {/* Información del Cliente */}
                <div className="space-y-4">
                  <h4 className="text-lg font-medium text-gray-900">Información del Cliente</h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nombre del Cliente
                      </label>
                      <input
                        type="text"
                        value={editOrderData.customerName}
                        onChange={(e) => setEditOrderData({...editOrderData, customerName: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                        required
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Teléfono del Cliente
                      </label>
                      <input
                        type="tel"
                        value={editOrderData.customerPhone}
                        onChange={(e) => setEditOrderData({...editOrderData, customerPhone: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* Información de Entrega */}
                <div className="space-y-4">
                  <h4 className="text-lg font-medium text-gray-900">Información de Entrega</h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tipo de Entrega
                      </label>
                      <select
                        value={editOrderData.deliveryType}
                        onChange={(e) => setEditOrderData({...editOrderData, deliveryType: e.target.value as 'delivery' | 'pickup'})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                        required
                      >
                        <option value="">Seleccionar tipo</option>
                        <option value="delivery">Delivery</option>
                        <option value="pickup">Retiro</option>
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Referencias
                      </label>
                      <input
                        type="text"
                        value={editOrderData.references}
                        onChange={(e) => setEditOrderData({...editOrderData, references: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                        placeholder="Direcciones o referencias"
                      />
                    </div>
                  </div>
                </div>

                {/* Información de Timing */}
                <div className="space-y-4">
                  <h4 className="text-lg font-medium text-gray-900">Programación</h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tipo de Entrega
                      </label>
                      <select
                        value={editOrderData.timingType}
                        onChange={(e) => setEditOrderData({...editOrderData, timingType: e.target.value as 'immediate' | 'scheduled'})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      >
                        <option value="immediate">Inmediato</option>
                        <option value="scheduled">Programado</option>
                      </select>
                    </div>
                    
                    {editOrderData.timingType === 'scheduled' && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Fecha
                          </label>
                          <input
                            type="date"
                            value={editOrderData.scheduledDate}
                            onChange={(e) => setEditOrderData({...editOrderData, scheduledDate: e.target.value})}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                            min={formatDateForInput()}
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Hora
                          </label>
                          <input
                            type="time"
                            value={editOrderData.scheduledTime}
                            onChange={(e) => setEditOrderData({...editOrderData, scheduledTime: e.target.value})}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Información de Pago */}
                <div className="space-y-4">
                  <h4 className="text-lg font-medium text-gray-900">Información de Pago</h4>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Método de Pago
                      </label>
                      <div className="space-y-2">
                        <label className="flex items-center">
                          <input
                            type="radio"
                            name="editPaymentMethod"
                            value="cash"
                            checked={editOrderData.paymentMethod === 'cash'}
                            onChange={(e) => setEditOrderData({
                              ...editOrderData, 
                              paymentMethod: e.target.value as 'cash',
                              cashAmount: 0,
                              transferAmount: 0
                            })}
                            className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
                          />
                          <span className="ml-2 text-sm text-gray-700">
                            <i className="bi bi-cash me-1"></i>
                            Efectivo
                          </span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="radio"
                            name="editPaymentMethod"
                            value="transfer"
                            checked={editOrderData.paymentMethod === 'transfer'}
                            onChange={(e) => setEditOrderData({
                              ...editOrderData, 
                              paymentMethod: e.target.value as 'transfer',
                              cashAmount: 0,
                              transferAmount: 0
                            })}
                            className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
                          />
                          <span className="ml-2 text-sm text-gray-700">
                            <i className="bi bi-bank me-1"></i>
                            Transferencia
                          </span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="radio"
                            name="editPaymentMethod"
                            value="mixed"
                            checked={editOrderData.paymentMethod === 'mixed'}
                            onChange={(e) => setEditOrderData({
                              ...editOrderData, 
                              paymentMethod: e.target.value as 'mixed',
                              cashAmount: editOrderData.total / 2,
                              transferAmount: editOrderData.total / 2
                            })}
                            className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
                          />
                          <span className="ml-2 text-sm text-gray-700">
                            <i className="bi bi-cash-coin me-1"></i>
                            Pago Mixto (Efectivo + Transferencia)
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* Configuración de Pago Mixto */}
                    {editOrderData.paymentMethod === 'mixed' && (
                      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <h5 className="text-sm font-medium text-yellow-800 mb-3">
                          <i className="bi bi-calculator me-1"></i>
                          Distribución del Pago
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Monto en Efectivo
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={editOrderData.cashAmount || ''}
                              onChange={(e) => {
                                const cash = parseFloat(e.target.value) || 0;
                                const total = editOrderData.total;
                                const transfer = Math.max(0, total - cash);
                                setEditOrderData({
                                  ...editOrderData,
                                  cashAmount: cash,
                                  transferAmount: transfer
                                });
                              }}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-red-500 focus:border-red-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Monto por Transferencia
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={editOrderData.transferAmount || ''}
                              onChange={(e) => {
                                const transfer = parseFloat(e.target.value) || 0;
                                const total = editOrderData.total;
                                const cash = Math.max(0, total - transfer);
                                setEditOrderData({
                                  ...editOrderData,
                                  cashAmount: cash,
                                  transferAmount: transfer
                                });
                              }}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-red-500 focus:border-red-500"
                            />
                          </div>
                        </div>
                        <div className="mt-3 text-xs text-gray-600 bg-white p-2 rounded border">
                          <div className="flex justify-between">
                            <span>Total del pedido:</span>
                            <span className="font-medium">${editOrderData.total.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-green-600">
                            <span>Efectivo:</span>
                            <span>${(editOrderData.cashAmount || 0).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-blue-600">
                            <span>Transferencia:</span>
                            <span>${(editOrderData.transferAmount || 0).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between font-medium border-t pt-1 mt-1">
                            <span>Suma:</span>
                            <span className={
                              Math.abs((editOrderData.cashAmount || 0) + (editOrderData.transferAmount || 0) - editOrderData.total) < 0.01
                                ? 'text-green-600' 
                                : 'text-red-600'
                            }>
                              ${((editOrderData.cashAmount || 0) + (editOrderData.transferAmount || 0)).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Estado de Pago
                        </label>
                        <select
                          value={editOrderData.paymentStatus}
                          onChange={(e) => setEditOrderData({...editOrderData, paymentStatus: e.target.value as 'pending' | 'validating' | 'paid'})}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                        >
                          <option value="pending">Pendiente</option>
                          <option value="validating">Validando</option>
                          <option value="paid">Pagado</option>
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Total ($)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editOrderData.total}
                          onChange={(e) => setEditOrderData({...editOrderData, total: parseFloat(e.target.value) || 0})}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                          required
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Estado de la Orden */}
                <div className="space-y-4">
                  <h4 className="text-lg font-medium text-gray-900">Estado de la Orden</h4>
                  
                  <div>
                    <select
                      value={editOrderData.status}
                      onChange={(e) => setEditOrderData({...editOrderData, status: e.target.value as Order['status']})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      <option value="pending">🕐 Pendiente</option>
                      <option value="confirmed">✅ Confirmado</option>
                      <option value="preparing">👨‍🍳 Preparando</option>
                      <option value="ready">🔔 Listo</option>
                      <option value="delivered">📦 Entregado</option>
                      <option value="cancelled">❌ Cancelado</option>
                    </select>
                  </div>
                </div>

                {/* Mensaje de validación para pago mixto */}
                {editOrderData.paymentMethod === 'mixed' && Math.abs((editOrderData.cashAmount || 0) + (editOrderData.transferAmount || 0) - editOrderData.total) >= 0.01 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm text-red-600 flex items-center">
                      <i className="bi bi-exclamation-triangle me-2"></i>
                      La suma de efectivo y transferencia debe ser igual al total del pedido.
                    </p>
                  </div>
                )}

                {/* Botones */}
                <div className="flex space-x-4">
                  <button
                    type="submit"
                    disabled={updatingOrder || (editOrderData.paymentMethod === 'mixed' && Math.abs((editOrderData.cashAmount || 0) + (editOrderData.transferAmount || 0) - editOrderData.total) >= 0.01)}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {updatingOrder ? (
                      <>
                        <i className="bi bi-arrow-repeat spin me-2"></i>
                        Actualizando...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check-lg me-2"></i>
                        Guardar Cambios
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEditOrderModal(false)}
                    disabled={updatingOrder}
                    className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Botón flotante para crear pedido */}
      <button
        onClick={() => setShowManualOrderModal(true)}
        className="fixed bottom-4 right-4 lg:bottom-6 lg:right-6 bg-red-600 hover:bg-red-700 text-white rounded-full w-12 h-12 lg:w-16 lg:h-16 shadow-lg transition-colors z-50 flex items-center justify-center"
        title="Crear Pedido"
      >
        <i className="bi bi-plus-lg text-lg lg:text-xl"></i>
      </button>

      {/* Sidebar para crear pedido manual */}
      <ManualOrderSidebar
        isOpen={showManualOrderModal}
        onClose={() => setShowManualOrderModal(false)}
        business={business}
        products={products}
        onOrderCreated={loadOrders}
      />
      </div>
    </div>
  )
}
