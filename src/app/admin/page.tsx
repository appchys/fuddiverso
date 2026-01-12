'use client'

import { useState, useEffect } from 'react'
import { getAllOrders, getAllBusinesses, getVisitsForBusiness } from '@/lib/database'
import { Order, Business } from '@/types'

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalOrdersToday: 0,
    revenueToday: 0,
    activeStores: 0,
    totalOrders: 0,
    totalRevenue: 0
  })
  const [orders, setOrders] = useState<Order[]>([])
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [visitsMap, setVisitsMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [visitData, setVisitData] = useState([
    { hour: '00:00', visits: 12 },
    { hour: '04:00', visits: 8 },
    { hour: '08:00', visits: 25 },
    { hour: '12:00', visits: 45 },
    { hour: '16:00', visits: 38 },
    { hour: '20:00', visits: 52 }
  ])

  useEffect(() => {
    loadData()
    loadVisitsFromStorage()
  }, [])

  const loadVisitsFromStorage = () => {
    try {
      const map: Record<string, number> = {}
      // Leer todas las keys de localStorage que empiecen con 'visits:'
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key) continue
        if (key.startsWith('visits:')) {
          const businessId = key.replace('visits:', '')
          const value = parseInt(localStorage.getItem(key) || '0', 10) || 0
          map[businessId] = value
        }
      }
      setVisitsMap(map)
    } catch (e) {
      console.error('Error loading visits from storage:', e)
    }
  }

  const loadData = async () => {
    try {
      setLoading(true)
      
      // Cargar todos los pedidos y negocios con manejo de errores mejorado
      const allBusinesses = await getAllBusinesses()
      // Filtrar negocios válidos
      const validBusinesses = allBusinesses.filter(business => business && business.id && business.name)
      setBusinesses(validBusinesses)

      // Cargar visitas desde Firestore para cada business (paralelo)
      try {
        const visitPromises = validBusinesses.map(b => getVisitsForBusiness(b.id))
        const visitResults = await Promise.all(visitPromises)
        const map: Record<string, number> = {}
        validBusinesses.forEach((b, idx) => {
          map[b.id] = visitResults[idx] || 0
        })

        // Combinar con pendingVisits (localStorage) para mostrar conteos locales pendientes
        try {
          const pendingRaw = localStorage.getItem('pendingVisits')
          if (pendingRaw) {
            const pending = JSON.parse(pendingRaw)
            for (const [bId, cnt] of Object.entries(pending)) {
              map[bId] = (map[bId] || 0) + Number(cnt)
            }
          }
        } catch (e) {
          console.warn('Error reading pendingVisits from localStorage:', e)
        }

        setVisitsMap(map)
      } catch (e) {
        console.error('Error loading visits for businesses:', e)
      }
      const allOrders = await getAllOrders()
      // Filtrar pedidos válidos
      const validOrders = allOrders.filter(order => 
        order && 
        order.id && 
        order.customer && 
        order.customer.name && 
        typeof order.total === 'number' &&
        order.createdAt
      )
      setOrders(validOrders)

      // Calcular estadísticas
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      const ordersToday = validOrders.filter((order: Order) => {
        try {
          const orderDate = new Date(order.createdAt)
          orderDate.setHours(0, 0, 0, 0)
          return orderDate.getTime() === today.getTime()
        } catch (e) {
          return false
        }
      })

      const revenueToday = ordersToday.reduce((sum: number, order: Order) => {
        return sum + (order?.total || 0)
      }, 0)
      
      const totalRevenue = validOrders.reduce((sum: number, order: Order) => {
        return sum + (order?.total || 0)
      }, 0)
      
      setStats({
        totalOrdersToday: ordersToday.length,
        revenueToday,
        activeStores: validBusinesses.length,
        totalOrders: validOrders.length,
        totalRevenue
      })

    } catch (error) {
      console.error('Error loading admin data:', error)
      // Mostrar datos de fallback
      setStats({
        totalOrdersToday: 0,
        revenueToday: 0,
        activeStores: 0,
        totalOrders: 0,
        totalRevenue: 0
      })
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard Administrativo</h1>
        <p className="text-gray-600 mt-2">Resumen general de la plataforma fuddi.shop</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Pedidos Hoy */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Pedidos Hoy</p>
              <p className="text-3xl font-bold text-gray-900">{stats.totalOrdersToday}</p>
            </div>
            <div className="p-3 bg-blue-100 rounded-full">
              <i className="bi bi-bag-check text-2xl text-blue-600"></i>
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm">
            <span className="text-green-600 font-medium">+12%</span>
            <span className="text-gray-600 ml-2">vs ayer</span>
          </div>
        </div>

        {/* Ingresos Hoy */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Ingresos Hoy</p>
              <p className="text-3xl font-bold text-gray-900">${stats.revenueToday.toFixed(2)}</p>
            </div>
            <div className="p-3 bg-green-100 rounded-full">
              <i className="bi bi-cash-coin text-2xl text-green-600"></i>
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm">
            <span className="text-green-600 font-medium">+8%</span>
            <span className="text-gray-600 ml-2">vs ayer</span>
          </div>
        </div>

        {/* Tiendas Activas */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Tiendas Activas</p>
              <p className="text-3xl font-bold text-gray-900">{stats.activeStores}</p>
            </div>
            <div className="p-3 bg-purple-100 rounded-full">
              <i className="bi bi-shop text-2xl text-purple-600"></i>
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm">
            <span className="text-green-600 font-medium">+2</span>
            <span className="text-gray-600 ml-2">este mes</span>
          </div>
        </div>

        {/* Total Ingresos */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Ingresos</p>
              <p className="text-3xl font-bold text-gray-900">${stats.totalRevenue.toFixed(2)}</p>
            </div>
            <div className="p-3 bg-orange-100 rounded-full">
              <i className="bi bi-graph-up text-2xl text-orange-600"></i>
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm">
            <span className="text-green-600 font-medium">+25%</span>
            <span className="text-gray-600 ml-2">este mes</span>
          </div>
        </div>
      </div>

      {/* Gestión Rápida */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <a
          href="/admin/orders"
          className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg shadow-sm p-6 border border-orange-200 hover:shadow-md transition-shadow cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-orange-700">Pedidos</p>
              <p className="text-xs text-orange-600 mt-1">Ver actividad</p>
            </div>
            <i className="bi bi-clipboard-list text-2xl text-orange-600"></i>
          </div>
        </a>
        <a
          href="/admin/coverage-zones"
          className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg shadow-sm p-6 border border-purple-200 hover:shadow-md transition-shadow cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-purple-700">Zonas</p>
              <p className="text-xs text-purple-600 mt-1">Cobertura</p>
            </div>
            <i className="bi bi-map text-2xl text-purple-600"></i>
          </div>
        </a>
        <a
          href="/business"
          className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow-sm p-6 border border-blue-200 hover:shadow-md transition-shadow cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-700">Negocios</p>
              <p className="text-xs text-blue-600 mt-1">Administrar</p>
            </div>
            <i className="bi bi-shop text-2xl text-blue-600"></i>
          </div>
        </a>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Gráfico de Visitas */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Visitas por Hora</h3>
          <div className="space-y-4">
            {visitData.map((data, index) => (
              <div key={index} className="flex items-center space-x-4">
                <span className="text-sm font-medium text-gray-600 w-12">{data.hour}</span>
                <div className="flex-1 bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-blue-500 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${(data.visits / 60) * 100}%` }}
                  ></div>
                </div>
                <span className="text-sm font-medium text-gray-900 w-8">{data.visits}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tiendas Más Activas */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Tiendas Más Activas</h3>
          <div className="space-y-4">
            {businesses.slice(0, 5).map((business, index) => {
              const businessOrders = orders.filter(order => order?.businessId === business?.id)
              const businessRevenue = businessOrders.reduce((sum: number, order: any) => sum + (order?.total || 0), 0)
              const storeCreatedOrders = businessOrders.filter((order: any) => order?.createdByAdmin).length
              const clientCreatedOrders = businessOrders.length - storeCreatedOrders
              
              return (
                <div key={business?.id || index} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gray-200 rounded-lg overflow-hidden">
                      {business?.image ? (
                        <img
                          src={business.image}
                          alt={business.name || 'Negocio'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                          <i className="bi bi-shop text-gray-400"></i>
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{business?.name || 'Sin nombre'}</p>
                      <p className="text-sm text-gray-600">
                        {businessOrders.length} pedidos 
                        (Tienda: {storeCreatedOrders} · Cliente: {clientCreatedOrders})
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-6">
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">Visitas</div>
                      <div className="text-lg font-medium">{visitsMap[business.id] ?? 0}</div>
                    </div>
                    <span className="font-semibold text-gray-900">${businessRevenue.toFixed(2)}</span>
                  </div>
                </div>
              )
            })}
          
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Pedidos Recientes</h3>
            <a
              href="/admin/orders"
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              Ver todos
            </a>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Pedido
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cliente
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tienda
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fecha
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {orders.slice(0, 5).map((order) => {
                const business = businesses.find(b => b.id === order.businessId)
                
                // Validaciones para evitar errores
                if (!order || !order.customer) {
                  return null // Skip orders without customer data
                }
                
                return (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">#{order.id?.slice(-6)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{order.customer?.name || 'Sin nombre'}</div>
                      <div className="text-sm text-gray-500">{order.customer?.phone || 'Sin teléfono'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{business?.name || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">${order.total?.toFixed(2) || '0.00'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        order.status === 'confirmed' ? 'bg-blue-100 text-blue-800' :
                        order.status === 'preparing' ? 'bg-orange-100 text-orange-800' :
                        order.status === 'ready' ? 'bg-green-100 text-green-800' :
                        order.status === 'delivered' ? 'bg-gray-100 text-gray-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {order.status === 'pending' ? 'Pendiente' :
                         order.status === 'confirmed' ? 'Confirmado' :
                         order.status === 'preparing' ? 'Preparando' :
                         order.status === 'ready' ? 'Listo' :
                         order.status === 'delivered' ? 'Entregado' :
                         'Cancelado'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'Sin fecha'}
                    </td>
                  </tr>
                )
              }).filter(Boolean)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
