'use client'

import { useState, useEffect } from 'react'
import {
  getAllOrders,
  getAllBusinesses,
  getVisitsForBusiness,
  getAllUserCreditsGlobal,
  getAllReferralLinksGlobal,
  getAllClientsGlobal
} from '@/lib/database'
import { Order, Business } from '@/types'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

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
  const [activeTab, setActiveTab] = useState<'general' | 'customers' | 'recommenders'>('general')
  const [customers, setCustomers] = useState<any[]>([])
  const [recommenders, setRecommenders] = useState<any[]>([])
  const [chartData, setChartData] = useState<any[]>([])

  // Estados para rango de fechas del gráfico
  const [dateRange, setDateRange] = useState({
    start: (() => {
      const d = new Date()
      d.setDate(d.getDate() - 13) // Default 14 días (incluyendo hoy)
      return d.toISOString().split('T')[0]
    })(),
    end: new Date().toISOString().split('T')[0]
  })

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

  // Effect para procesar datos del gráfico según el rango de fechas
  useEffect(() => {
    if (orders.length === 0) return

    const processChartData = () => {
      const start = new Date(dateRange.start)
      const end = new Date(dateRange.end)

      // Ajustar horas para comparación
      start.setHours(0, 0, 0, 0)
      end.setHours(0, 0, 0, 0)

      const days: Date[] = []
      const current = new Date(start)

      // Generar array de días en el rango (max 90 días por seguridad)
      let count = 0
      while (current <= end && count < 90) {
        days.push(new Date(current))
        current.setDate(current.getDate() + 1)
        count++
      }

      const groupedData = days.map(date => {
        const dateStr = date.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' })
        const dayOrders = orders.filter((order: Order) => {
          const orderDate = new Date(order.createdAt)
          orderDate.setHours(0, 0, 0, 0)
          return orderDate.getTime() === date.getTime()
        })

        const manual = dayOrders.filter(o => o.createdByAdmin).length
        const client = dayOrders.length - manual

        return {
          name: dateStr,
          manual,
          client
        }
      })
      setChartData(groupedData)
    }

    processChartData()
  }, [orders, dateRange])

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

      // Procesar Clientes Únicos
      const customerMap = new Map<string, any>()
      validOrders.forEach(order => {
        const phone = order.customer.phone
        if (!customerMap.has(phone)) {
          customerMap.set(phone, {
            name: order.customer.name,
            phone: phone,
            totalOrders: 0,
            spent: 0,
            lastOrder: order.createdAt
          })
        }
        const c = customerMap.get(phone)
        c.totalOrders += 1
        c.spent += order.total || 0
        if (new Date(order.createdAt) > new Date(c.lastOrder)) {
          c.lastOrder = order.createdAt
        }
      })
      setCustomers(Array.from(customerMap.values()).sort((a, b) => b.spent - a.spent))

      // Cargar Datos de Recomendadores y Clientes (Paralelo)
      const [allCredits, allLinks, allGlobalClients] = await Promise.all([
        getAllUserCreditsGlobal(),
        getAllReferralLinksGlobal(),
        getAllClientsGlobal()
      ])

      const processedCustomers = Array.from(customerMap.values())

      // Procesar Recomendadores
      const recommenderData = allCredits.map(credit => {
        const userLinks = allLinks.filter(l => l.createdBy === credit.userId)
        const totalClicks = userLinks.reduce((sum, l) => sum + (l.clicks || 0), 0)
        const totalConversions = userLinks.reduce((sum, l) => sum + (l.conversions || 0), 0)

        // Buscar en clientes de órdenes o en clientes globales registrados
        const customerFromOrders = processedCustomers.find(c => c.phone === credit.userId)
        const globalClient = allGlobalClients.find(c => c.celular === credit.userId)

        return {
          id: credit.id,
          phone: credit.userId,
          name: customerFromOrders?.name || globalClient?.nombres || 'Usuario',
          image: globalClient?.fotoUrl || null,
          credits: credit.availableCredits || 0,
          totalCredits: credit.totalCredits || 0,
          linksCount: userLinks.length,
          clicks: totalClicks,
          conversions: totalConversions
        }
      }).sort((a, b) => b.totalCredits - a.totalCredits)
      setRecommenders(recommenderData)

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

  const renderCustomersTab = () => {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Base de Clientes</h3>
          <p className="text-sm text-gray-500">Total: {customers.length} clientes únicos</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Teléfono</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider text-center">Órdenes</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider text-center">Gastado Acum.</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Última Compra</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {customers.map((c, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{c.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-500">{c.phone}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-gray-900 font-semibold">{c.totalOrders}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-red-600 font-bold">${c.spent.toFixed(2)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-500">{new Date(c.lastOrder).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderRecommendersTab = () => {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Top Recomendadores</h3>
          <p className="text-sm text-gray-500">Usuarios que más comparten y generan ventas</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Usuario</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider text-center">Créditos</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider text-center">Links Creados</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider text-center">Clicks</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider text-center font-bold text-red-600">Ventas (Conv)</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {recommenders.map((r, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gray-100 rounded-full overflow-hidden border border-gray-200 flex items-center justify-center">
                        {r.image ? (
                          <img
                            src={r.image}
                            alt={r.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(r.name)}&background=random`
                            }}
                          />
                        ) : (
                          <i className="bi bi-person text-xl text-gray-400"></i>
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-900">{r.name}</div>
                        <div className="text-xs text-gray-500">{r.phone}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <div className="text-sm font-bold text-gray-900">{r.totalCredits}</div>
                    <div className="text-xs text-gray-400">({r.credits} disp)</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">{r.linksCount}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">{r.clicks}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">
                      {r.conversions} ventas
                    </span>
                  </td>
                </tr>
              ))}
              {recommenders.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    No hay datos de recomendaciones registrados aún.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 md:space-y-8">
      {/* Header - Compacto en móvil */}
      <div className="flex flex-col gap-3">
        <h1 className="text-xl md:text-3xl font-bold text-gray-900">Dashboard Admin</h1>

        {/* Tabs - Scroll horizontal en móvil */}
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-1 scrollbar-hide">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex-shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'general' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <i className="bi bi-grid-1x2 md:hidden me-1.5"></i>
            General
          </button>
          <button
            onClick={() => setActiveTab('customers')}
            className={`flex-shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'customers' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <i className="bi bi-people md:hidden me-1.5"></i>
            Clientes
          </button>
          <button
            onClick={() => setActiveTab('recommenders')}
            className={`flex-shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'recommenders' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <i className="bi bi-share md:hidden me-1.5"></i>
            Recomendadores
          </button>
        </div>
      </div>

      {activeTab === 'general' ? (
        <>
          {/* Stats Grid - 2x2 en móvil */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
            <div className="bg-white rounded-xl shadow-sm p-4 md:p-6 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm font-medium text-gray-500">Pedidos Hoy</p>
                  <p className="text-xl md:text-2xl font-bold text-gray-900">{stats.totalOrdersToday}</p>
                </div>
                <div className="p-2 md:p-3 bg-blue-50 rounded-lg">
                  <i className="bi bi-cart-check text-lg md:text-xl text-blue-600"></i>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-4 md:p-6 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm font-medium text-gray-500">Ingresos Hoy</p>
                  <p className="text-xl md:text-2xl font-bold text-green-600">${stats.revenueToday.toFixed(0)}</p>
                </div>
                <div className="p-2 md:p-3 bg-green-50 rounded-lg">
                  <i className="bi bi-cash-stack text-lg md:text-xl text-green-600"></i>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-4 md:p-6 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm font-medium text-gray-500">Tiendas</p>
                  <p className="text-xl md:text-2xl font-bold text-gray-900">{stats.activeStores}</p>
                </div>
                <div className="p-2 md:p-3 bg-purple-50 rounded-lg">
                  <i className="bi bi-shop text-lg md:text-xl text-purple-600"></i>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-4 md:p-6 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm font-medium text-gray-500">Total Ventas</p>
                  <p className="text-xl md:text-2xl font-bold text-gray-900">${stats.totalRevenue.toFixed(0)}</p>
                </div>
                <div className="p-2 md:p-3 bg-orange-50 rounded-lg">
                  <i className="bi bi-graph-up text-lg md:text-xl text-orange-600"></i>
                </div>
              </div>
            </div>
          </div>

          {/* Accesos Rápidos - Scroll horizontal en móvil */}
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-3 lg:grid-cols-4 scrollbar-hide">
            <a
              href="/admin/orders"
              className="flex-shrink-0 w-36 md:w-auto bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl shadow-sm p-4 md:p-6 border border-orange-200 hover:shadow-md active:scale-[0.98] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-orange-700">Pedidos</p>
                  <p className="text-[11px] text-orange-600 mt-0.5">Ver actividad</p>
                </div>
                <i className="bi bi-clipboard-list text-xl md:text-2xl text-orange-600"></i>
              </div>
            </a>
            <a
              href="/admin/coverage-zones"
              className="flex-shrink-0 w-36 md:w-auto bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl shadow-sm p-4 md:p-6 border border-purple-200 hover:shadow-md active:scale-[0.98] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-purple-700">Zonas</p>
                  <p className="text-[11px] text-purple-600 mt-0.5">Cobertura</p>
                </div>
                <i className="bi bi-map text-xl md:text-2xl text-purple-600"></i>
              </div>
            </a>
            <a
              href="/admin/deliveries"
              className="flex-shrink-0 w-36 md:w-auto bg-gradient-to-br from-green-50 to-green-100 rounded-xl shadow-sm p-4 md:p-6 border border-green-200 hover:shadow-md active:scale-[0.98] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-green-700">Deliveries</p>
                  <p className="text-[11px] text-green-600 mt-0.5">Gestión</p>
                </div>
                <i className="bi bi-scooter text-xl md:text-2xl text-green-600"></i>
              </div>
            </a>
            <a
              href="/business"
              className="flex-shrink-0 w-36 md:w-auto bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl shadow-sm p-4 md:p-6 border border-blue-200 hover:shadow-md active:scale-[0.98] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-blue-700">Negocios</p>
                  <p className="text-[11px] text-blue-600 mt-0.5">Administrar</p>
                </div>
                <i className="bi bi-shop text-xl md:text-2xl text-blue-600"></i>
              </div>
            </a>
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Gráfico de Pedidos (Nuevo) */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200 lg:col-span-2">
              <div className="flex items-center justify-between mb-6">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Volumen de Pedidos</h3>
                    <p className="text-sm text-gray-500">Manuales vs Clientes (Apilado)</p>
                  </div>
                  <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-lg border border-gray-200">
                    <input
                      type="date"
                      value={dateRange.start}
                      onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                      className="bg-transparent text-xs font-medium text-gray-600 focus:outline-none cursor-pointer"
                    />
                    <span className="text-gray-400 text-xs">al</span>
                    <input
                      type="date"
                      value={dateRange.end}
                      onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                      className="bg-transparent text-xs font-medium text-gray-600 focus:outline-none cursor-pointer"
                    />
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
                    <span className="text-xs text-gray-600 font-medium">Tienda (Manual)</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
                    <span className="text-xs text-gray-600 font-medium">Cliente (Checkout)</span>
                  </div>
                </div>
              </div>

              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#9ca3af', fontSize: 12 }}
                      dy={10}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#9ca3af', fontSize: 12 }}
                    />
                    <Tooltip
                      cursor={{ fill: '#f9fafb' }}
                      contentStyle={{
                        borderRadius: '12px',
                        border: 'none',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                        padding: '12px'
                      }}
                    />
                    <Bar
                      dataKey="manual"
                      fill="#3b82f6"
                      stackId="a"
                      radius={[0, 0, 0, 0]}
                      barSize={20}
                    />
                    <Bar
                      dataKey="client"
                      fill="#ef4444"
                      stackId="a"
                      radius={[4, 4, 0, 0]}
                      barSize={20}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>


            {/* Pedidos Recientes - Mobile First */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 lg:col-span-2 overflow-hidden">
              <div className="p-4 md:p-6 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Pedidos Recientes</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{orders.length} pedidos totales</p>
                </div>
                <a href="/admin/orders" className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                  Ver todos
                  <i className="bi bi-chevron-right text-xs"></i>
                </a>
              </div>

              {/* Vista Móvil - Cards Dashboard */}
              <div className="md:hidden space-y-4 p-4 bg-gray-50/30">
                {orders.slice(0, 5).map((order) => {
                  const business = businesses.find(b => b.id === order.businessId)
                  if (!order || !order.customer) return null

                  const statusConfig: Record<string, { bg: string; text: string; icon: string }> = {
                    pending: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'bi-clock-history' },
                    confirmed: { bg: 'bg-blue-50', text: 'text-blue-700', icon: 'bi-check2-circle' },
                    preparing: { bg: 'bg-orange-50', text: 'text-orange-700', icon: 'bi-fire' },
                    ready: { bg: 'bg-green-50', text: 'text-green-700', icon: 'bi-bag-check' },
                    delivered: { bg: 'bg-gray-50', text: 'text-gray-600', icon: 'bi-house-check' },
                    cancelled: { bg: 'bg-red-50', text: 'text-red-700', icon: 'bi-x-circle' }
                  }
                  const status = statusConfig[order.status] || statusConfig.pending

                  return (
                    <div key={order.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm active:scale-[0.98] transition-all">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-gray-50 overflow-hidden border border-gray-100 shrink-0">
                            {business?.image ? (
                              <img src={business.image} alt={business.name || ''} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-200">
                                <i className="bi bi-shop"></i>
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-black text-gray-900 truncate uppercase tracking-tight">
                              {order.customer?.name || 'S/N'}
                            </h4>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate">
                              {business?.name || 'S/T'}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${status.bg} ${status.text} border border-current/10`}>
                            <i className={`bi ${status.icon}`}></i>
                            {order.status}
                          </span>
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                            {order.createdAt ? new Date(order.createdAt).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                        <a href="/admin/orders" className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-1">
                          Gestionar
                          <i className="bi bi-arrow-right"></i>
                        </a>
                      </div>
                    </div>
                  )
                }).filter(Boolean)}
              </div>

              {/* Vista Desktop - Tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pedido</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tienda</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {orders.slice(0, 5).map((order) => {
                      const business = businesses.find(b => b.id === order.businessId)
                      if (!order || !order.customer) return null

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
                            <div className="text-sm font-bold text-gray-900">${order.total?.toFixed(2) || '0.00'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
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
                                      order.status === 'delivered' ? 'Entregado' : 'Cancelado'}
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
        </>
      ) : activeTab === 'customers' ? (
        renderCustomersTab()
      ) : (
        renderRecommendersTab()
      )}
    </div>
  );
}
