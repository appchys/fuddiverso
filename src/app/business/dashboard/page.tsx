'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getBusiness, getProductsByBusiness, getOrdersByBusiness, updateOrderStatus, updateProduct, deleteProduct, getBusinessesByOwner, uploadImage, updateBusiness, addBusinessAdministrator, removeBusinessAdministrator, updateAdministratorPermissions } from '@/lib/database'
import { Business, Product, Order } from '@/types'
import { auth } from '@/lib/firebase'

export default function BusinessDashboard() {
  const router = useRouter()
  const [business, setBusiness] = useState<Business | null>(null)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'products' | 'orders' | 'profile' | 'admins'>('orders')
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null)
  const [showBusinessDropdown, setShowBusinessDropdown] = useState(false)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [editedBusiness, setEditedBusiness] = useState<Business | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const loadBusinesses = async () => {
      try {
        // Primero intentar obtener el ownerId (usuario actual)
        const ownerId = window.localStorage.getItem('ownerId');
        const storedBusinessId = window.localStorage.getItem('businessId');
        
        if (!ownerId && !storedBusinessId) {
          console.warn('[DASHBOARD] No hay ownerId ni businessId, redirigiendo a login');
          router.push('/business/login');
          return;
        }

        // Si tenemos ownerId, cargar todas las tiendas del usuario
        if (ownerId) {
          const userBusinesses = await getBusinessesByOwner(ownerId);
          setBusinesses(userBusinesses);
          
          // Si hay tiendas, seleccionar la primera o la guardada
          if (userBusinesses.length > 0) {
            const businessToSelect = storedBusinessId 
              ? userBusinesses.find(b => b.id === storedBusinessId) || userBusinesses[0]
              : userBusinesses[0];
            
            setSelectedBusinessId(businessToSelect.id);
            setBusiness(businessToSelect);
            // Guardar en localStorage para que otras páginas puedan acceder
            localStorage.setItem('currentBusinessId', businessToSelect.id);
          }
        } else if (storedBusinessId) {
          // Fallback: cargar solo la tienda actual (modo legacy)
          const businessData = await getBusiness(storedBusinessId);
          if (businessData) {
            setBusinesses([businessData]);
            setSelectedBusinessId(businessData.id);
            setBusiness(businessData);
            // Guardar en localStorage para que otras páginas puedan acceder
            localStorage.setItem('currentBusinessId', businessData.id);
          }
        }
      } catch (error) {
        console.error('Error loading businesses:', error);
        router.push('/business/login');
      } finally {
        setLoading(false);
      }
    };

    loadBusinesses();
  }, [router]);

  // Cargar datos específicos cuando se selecciona una tienda
  useEffect(() => {
    if (!selectedBusinessId) return;

    const loadBusinessData = async () => {
      try {
        // Cargar productos
        const productsData = await getProductsByBusiness(selectedBusinessId);
        setProducts(productsData);

        // Cargar órdenes
        const ordersData = await getOrdersByBusiness(selectedBusinessId);
        setOrders(ordersData);

        // Actualizar localStorage
        localStorage.setItem('businessId', selectedBusinessId);
      } catch (error) {
        console.error('Error loading business data:', error);
      }
    };

    loadBusinessData();
  }, [selectedBusinessId]);

  const handleBusinessChange = (businessId: string) => {
    const selectedBusiness = businesses.find(b => b.id === businessId);
    if (selectedBusiness) {
      setSelectedBusinessId(businessId);
      setBusiness(selectedBusiness);
      // Guardar en localStorage para que otras páginas puedan acceder
      localStorage.setItem('currentBusinessId', businessId);
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
      console.error('Error updating order status:', error)
    }
  }

  const handleToggleAvailability = async (productId: string, currentAvailability: boolean) => {
    try {
      await updateProduct(productId, { isAvailable: !currentAvailability })
      setProducts(prev => prev.map(product => 
        product.id === productId ? { ...product, isAvailable: !currentAvailability } : product
      ))
    } catch (error) {
      console.error('Error updating product availability:', error)
    }
  }

  const handleDeleteProduct = async (productId: string) => {
    if (window.confirm('¿Estás seguro de que quieres eliminar este producto?')) {
      try {
        await deleteProduct(productId)
        setProducts(prev => prev.filter(product => product.id !== productId))
      } catch (error) {
        console.error('Error deleting product:', error)
      }
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
      
      console.log('Imagen de portada subida exitosamente:', imageUrl);
    } catch (error) {
      console.error('Error subiendo imagen de portada:', error);
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
      
      console.log('Imagen de perfil subida exitosamente:', imageUrl);
    } catch (error) {
      console.error('Error subiendo imagen de perfil:', error);
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
      console.log('Perfil actualizado exitosamente:', editedBusiness);
    } catch (error) {
      console.error('Error guardando perfil:', error);
      alert('Error al guardar los cambios. Inténtalo de nuevo.');
    }
  };

  // Función para actualizar campo del negocio editado
  const handleBusinessFieldChange = (field: keyof Business, value: any) => {
    if (!editedBusiness) return;
    setEditedBusiness({ ...editedBusiness, [field]: value });
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
      console.error('Error adding admin:', error);
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
      console.error('Error removing admin:', error);
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
      console.error('Error updating permissions:', error);
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
    localStorage.removeItem('businessId')
    router.push('/')
  }

  // Función para categorizar pedidos
  const categorizeOrders = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayOrders = orders.filter(order => {
      const orderDate = new Date(order.timing?.scheduledTime || order.createdAt);
      return orderDate >= today && orderDate < tomorrow;
    }).sort((a, b) => {
      const timeA = new Date(a.timing?.scheduledTime || a.createdAt).getTime();
      const timeB = new Date(b.timing?.scheduledTime || b.createdAt).getTime();
      return timeA - timeB;
    });

    const upcomingOrders = orders.filter(order => {
      const orderDate = new Date(order.timing?.scheduledTime || order.createdAt);
      return orderDate >= tomorrow;
    }).sort((a, b) => {
      const timeA = new Date(a.timing?.scheduledTime || a.createdAt).getTime();
      const timeB = new Date(b.timing?.scheduledTime || b.createdAt).getTime();
      return timeA - timeB;
    });

    const pastOrders = orders.filter(order => {
      const orderDate = new Date(order.timing?.scheduledTime || order.createdAt);
      return orderDate < today;
    }).sort((a, b) => {
      const timeA = new Date(a.timing?.scheduledTime || a.createdAt).getTime();
      const timeB = new Date(b.timing?.scheduledTime || b.createdAt).getTime();
      return timeB - timeA;
    });

    return { todayOrders, upcomingOrders, pastOrders };
  };

  const formatTime = (dateValue: string | Date) => {
    const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
    return date.toLocaleTimeString('es-EC', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDate = (dateValue: string | Date) => {
    const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
    return date.toLocaleDateString('es-EC', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
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

  const OrderCard = ({ order, isToday = false }: { order: Order, isToday?: boolean }) => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="font-bold text-lg text-gray-900 mb-1">
            {order.customer?.name || 'Cliente sin nombre'}
          </h3>
          <p className="text-gray-600 text-sm mb-1">
            <i className="bi bi-telephone me-1"></i>{order.customer?.phone || 'Sin teléfono'}
          </p>
          <p className="text-gray-600 text-sm mb-2">
            <i className={`bi ${order.delivery?.type === 'delivery' ? 'bi-truck' : 'bi-shop'} me-1`}></i>
            {order.delivery?.type === 'delivery' ? 'Entrega a domicilio' : 'Recoger en tienda'}
            {order.delivery?.references && (
              <span className="block text-xs text-gray-500 mt-1">
                <i className="bi bi-geo-alt me-1"></i>{order.delivery.references}
              </span>
            )}
          </p>
          {isToday && (
            <p className="text-sm font-medium text-orange-600">
              <i className="bi bi-clock me-1"></i>{formatTime(order.timing?.scheduledTime || order.createdAt)}
            </p>
          )}
          {!isToday && (
            <p className="text-sm text-gray-500">
              📅 {formatDate(order.timing?.scheduledTime || order.createdAt)}
            </p>
          )}
        </div>
        <div className="text-right ml-4">
          <span className="text-2xl font-bold text-emerald-600">
            ${order.total?.toFixed(2) || '0.00'}
          </span>
          <div className="mt-2">
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(order.status)}`}>
              {getStatusText(order.status)}
            </span>
          </div>
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-900 mb-3">Productos:</h4>
        <div className="space-y-2">
          {order.items?.map((item: any, index) => (
            <div key={index} className="flex justify-between items-center py-2 px-3 bg-gray-50 rounded-lg">
              <div className="flex-1">
                <span className="font-medium text-gray-900">
                  {item.quantity}x {item.name || item.product?.name || 'Producto sin nombre'}
                </span>
                {(item.description || item.product?.description) && (
                  <p className="text-xs text-gray-500 mt-1">{item.description || item.product?.description}</p>
                )}
              </div>
              <span className="font-bold text-gray-900 ml-4">
                ${((item.price || item.product?.price || 0) * (item.quantity || 1)).toFixed(2)}
              </span>
            </div>
          )) || (
            <div className="text-sm text-gray-500 italic">No hay productos</div>
          )}
        </div>
      </div>

      <div className="border-t pt-4 mt-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={order.status}
            onChange={(e) => handleStatusChange(order.id, e.target.value as Order['status'])}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
          >
            <option value="pending">🕐 Pendiente</option>
            <option value="confirmed">✅ Confirmado</option>
            <option value="preparing">👨‍🍳 Preparando</option>
            <option value="ready">🔔 Listo</option>
            <option value="delivered">📦 Entregado</option>
            <option value="cancelled">❌ Cancelado</option>
          </select>
          
          <div className="flex gap-2">
            <span className="text-xs text-gray-500 px-2 py-1 bg-gray-100 rounded">
              💳 {order.payment?.method === 'cash' ? 'Efectivo' : 'Tarjeta'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

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
    console.warn('[DASHBOARD] No se pudo cargar la información del negocio. businessId:', localStorage.getItem('businessId'));
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
            <div className="flex items-center space-x-3 sm:space-x-6">
              <Link href="/" className="text-xl sm:text-2xl font-bold text-red-600">
                Fuddiverso
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
                    <span className="text-gray-700 font-medium">
                      {business?.name || 'Cargando...'}
                    </span>
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
                    {businesses.map((biz) => (
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
                          <p className="text-sm text-gray-500 truncate">@{biz.username}</p>
                        </div>
                        {selectedBusinessId === biz.id && (
                          <i className="bi bi-check-circle-fill text-red-500 flex-shrink-0"></i>
                        )}
                      </button>
                    ))}
                    
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Navigation Tabs */}
        <div className="border-b border-gray-200 mb-6 sm:mb-8">
          <nav className="-mb-px flex space-x-4 sm:space-x-8 overflow-x-auto">
            <button
              onClick={() => setActiveTab('orders')}
              className={`py-2 px-1 sm:px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                activeTab === 'orders'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <i className="bi bi-clipboard-check me-1 sm:me-2"></i>
              <span className="hidden sm:inline">Pedidos ({orders.length})</span>
              <span className="sm:hidden">Pedidos</span>
            </button>
            <button
              onClick={() => setActiveTab('products')}
              className={`py-2 px-1 sm:px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                activeTab === 'products'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <i className="bi bi-box-seam me-1 sm:me-2"></i>
              <span className="hidden sm:inline">Productos ({products.length})</span>
              <span className="sm:hidden">Productos</span>
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`py-2 px-1 sm:px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                activeTab === 'profile'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <i className="bi bi-shop me-1 sm:me-2"></i>
              <span className="hidden sm:inline">Perfil</span>
              <span className="sm:hidden">Perfil</span>
            </button>
            <button
              onClick={() => setActiveTab('admins')}
              className={`py-2 px-1 sm:px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                activeTab === 'admins'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <i className="bi bi-people me-1 sm:me-2"></i>
              <span className="hidden sm:inline">Administradores</span>
              <span className="sm:hidden">Admins</span>
            </button>
          </nav>
        </div>

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <div className="space-y-8">
            {(() => {
              const { todayOrders, upcomingOrders, pastOrders } = categorizeOrders();
              
              return (
                <>
                  {/* Pedidos de Hoy */}
                  <div>
                    <div className="flex items-center gap-3 mb-6">
                      <h2 className="text-2xl font-bold text-gray-900">
                        <i className="bi bi-calendar-check me-2"></i>Pedidos de Hoy
                      </h2>
                      <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-medium">
                        {todayOrders.length} pedidos
                      </span>
                    </div>
                    
                    {todayOrders.length === 0 ? (
                      <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
                        <div className="text-6xl mb-4">📅</div>
                        <p className="text-gray-600 text-lg">No tienes pedidos para hoy</p>
                        <p className="text-gray-500 text-sm mt-2">Los nuevos pedidos aparecerán aquí</p>
                      </div>
                    ) : (
                      <div className="grid gap-6">
                        {todayOrders.map((order) => (
                          <OrderCard key={order.id} order={order} isToday={true} />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Pedidos Próximos */}
                  {upcomingOrders.length > 0 && (
                    <div>
                      <div className="flex items-center gap-3 mb-6">
                        <h2 className="text-2xl font-bold text-gray-900">
                          <i className="bi bi-clock me-2"></i>Pedidos Próximos
                        </h2>
                        <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
                          {upcomingOrders.length} pedidos
                        </span>
                      </div>
                      
                      <div className="grid gap-6">
                        {upcomingOrders.map((order) => (
                          <OrderCard key={order.id} order={order} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Historial */}
                  {pastOrders.length > 0 && (
                    <div>
                      <div className="flex items-center gap-3 mb-6">
                        <h2 className="text-2xl font-bold text-gray-900">
                          <i className="bi bi-journal-text me-2"></i>Historial de Pedidos
                        </h2>
                        <span className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm font-medium">
                          {pastOrders.length} pedidos
                        </span>
                      </div>
                      
                      <div className="grid gap-6">
                        {pastOrders.slice(0, 10).map((order) => (
                          <OrderCard key={order.id} order={order} />
                        ))}
                      </div>
                      
                      {pastOrders.length > 10 && (
                        <div className="text-center mt-6">
                          <p className="text-gray-500">Mostrando los últimos 10 pedidos</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
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
                          <Link
                            href={`/business/products/edit/${product.id}`}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Editar producto"
                          >
                            <i className="bi bi-pencil text-sm"></i>
                          </Link>
                          
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
  )
}
