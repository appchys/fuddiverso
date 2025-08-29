'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getBusiness, getProductsByBusiness, getOrdersByBusiness, updateOrderStatus } from '@/lib/database'
import { Business, Product, Order } from '@/types'

export default function BusinessDashboard() {
  const router = useRouter()
  const [business, setBusiness] = useState<Business | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'products' | 'orders' | 'profile'>('orders')

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const businessId = window.localStorage.getItem('businessId');
    console.log('[DASHBOARD] businessId en localStorage:', businessId);
    if (!businessId) {
      console.warn('[DASHBOARD] No hay businessId en localStorage, redirigiendo a login');
      router.push('/business/login');
      return;
    }
    (async () => {
      try {
        // Cargar datos del negocio
        const businessData = await getBusiness(businessId);
        console.log('[DASHBOARD] Datos del negocio cargados:', businessData);
        setBusiness(businessData);

        // Cargar productos
        const productsData = await getProductsByBusiness(businessId);
        setProducts(productsData);

        // Cargar órdenes
        const ordersData = await getOrdersByBusiness(businessId);
        setOrders(ordersData);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

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
            📞 {order.customer?.phone || 'Sin teléfono'}
          </p>
          <p className="text-gray-600 text-sm mb-2">
            {order.delivery?.type === 'delivery' ? '🚚 Entrega a domicilio' : '🏪 Recoger en tienda'}
            {order.delivery?.references && (
              <span className="block text-xs text-gray-500 mt-1">
                📍 {order.delivery.references}
              </span>
            )}
          </p>
          {isToday && (
            <p className="text-sm font-medium text-orange-600">
              ⏰ {formatTime(order.timing?.scheduledTime || order.createdAt)}
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
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <Link href="/" className="text-2xl font-bold text-red-600">
                Fuddiverso
              </Link>
              <span className="ml-4 text-gray-600">Dashboard</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">Hola, {business.name}</span>
              <button
                onClick={handleLogout}
                className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200"
              >
                Cerrar Sesión
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Navigation Tabs */}
        <div className="border-b border-gray-200 mb-8">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('orders')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'orders'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              📋 Pedidos ({orders.length})
            </button>
            <button
              onClick={() => setActiveTab('products')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'products'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              🍕 Productos ({products.length})
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'profile'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              🏪 Perfil
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
                      <h2 className="text-2xl font-bold text-gray-900">🚀 Pedidos de Hoy</h2>
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
                        <h2 className="text-2xl font-bold text-gray-900">⏰ Pedidos Próximos</h2>
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
                        <h2 className="text-2xl font-bold text-gray-900">📚 Historial de Pedidos</h2>
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
              <h2 className="text-2xl font-bold text-gray-900">🍕 Mis Productos</h2>
              <Link
                href="/business/products/add"
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                + Agregar Producto
              </Link>
            </div>

            {products.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🍽️</div>
                <p className="text-gray-600 mb-4 text-lg">Aún no tienes productos registrados</p>
                <Link
                  href="/business/products/add"
                  className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors"
                >
                  Agregar Primer Producto
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.map((product) => (
                  <div key={product.id} className="bg-white rounded-lg shadow-md overflow-hidden">
                    {product.image && (
                      <img
                        src={product.image}
                        alt={product.name}
                        className="w-full h-48 object-cover"
                      />
                    )}
                    <div className="p-4">
                      <h3 className="font-semibold text-lg text-gray-900 mb-2">
                        {product.name}
                      </h3>
                      <p className="text-gray-600 text-sm mb-2">{product.description}</p>
                      <div className="flex justify-between items-center">
                        <span className="text-red-600 font-bold text-xl">
                          ${product.price.toFixed(2)}
                        </span>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          product.isAvailable
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {product.isAvailable ? 'Disponible' : 'No disponible'}
                        </span>
                      </div>
                      <div className="mt-2">
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                          {product.category}
                        </span>
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
            <h2 className="text-2xl font-bold text-gray-900 mb-6">🏪 Información del Negocio</h2>
            
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre del Negocio
                  </label>
                  <p className="text-gray-900">{business.name}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <p className="text-gray-900">{business.email}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Teléfono
                  </label>
                  <p className="text-gray-900">{business.phone}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Categoría
                  </label>
                  <p className="text-gray-900">{business.categories?.join(', ') || 'Sin categorías'}</p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Dirección
                  </label>
                  <p className="text-gray-900">{business.address}</p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Descripción
                  </label>
                  <p className="text-gray-900">{business.description}</p>
                </div>
              </div>

              {business.image && (
                <div className="mt-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Imagen del Negocio
                  </label>
                  <img
                    src={business.image}
                    alt={business.name}
                    className="w-32 h-32 object-cover rounded-lg"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
