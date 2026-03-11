'use client'

import { useState, useEffect, Fragment, lazy, Suspense } from 'react'

const TelegramTemplateEditor = lazy(() => import('@/components/TelegramTemplateEditor'))
const ProductsList = lazy(() => import('@/components/ProductsList'))
import {
  getAllOrders,
  getAllBusinesses,
  getVisitsForBusiness,
  getAllUserCreditsGlobal,
  getAllReferralLinksGlobal,
  getAllClientsGlobal,
  getAllDeliveries,
  addWalletBalance
} from '@/lib/database'
import { normalizeEcuadorianPhone } from '@/lib/validation'
import { isStoreOpen } from '@/lib/store-utils'
import { Order, Business, Delivery } from '@/types'
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
  const [activeTab, setActiveTab] = useState<'home' | 'general' | 'customers' | 'recommenders' | 'templates' | 'products' | 'orders'>('home')

  // Estados para filtros del historial de órdenes
  const [filterOrdersBusiness, setFilterOrdersBusiness] = useState<string>('all')
  const [filterOrdersDeliveryType, setFilterOrdersDeliveryType] = useState<'all' | 'delivery' | 'pickup'>('all')
  const [filterOrdersDateRange, setFilterOrdersDateRange] = useState({
    start: (() => {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      return d.toISOString().split('T')[0]
    })(),
    end: new Date().toISOString().split('T')[0]
  })

  const [customers, setCustomers] = useState<any[]>([])
  const [recommenders, setRecommenders] = useState<any[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [chartData, setChartData] = useState<any[]>([])
  const [telegramChartData, setTelegramChartData] = useState<any[]>([])
  const [linkedClients, setLinkedClients] = useState<any[]>([])

  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  // WALLET CREDIT FORM STATE
  const [walletForm, setWalletForm] = useState({ phone: '', amount: '', concept: '' })
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletMessage, setWalletMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

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
    document.title = 'Panel de administración - Fuddi'
  }, [])

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

    // Actualizar estado de apertura cada minuto
    const interval = setInterval(() => {
      setBusinesses(prev => prev.map(b => ({
        ...b,
        isOpen: isStoreOpen(b)
      })))
    }, 60000)

    return () => clearInterval(interval)
  }, [orders, dateRange])

  // New useEffect to fetch and process client data for Telegram chart
  useEffect(() => {
    const fetchTelegramData = async () => {
      try {
        const clients = await getAllClientsGlobal();

        // Filter clients with Telegram link
        const filteredLinkedClients = clients.filter(c => c.lastTelegramLinkDate);

        // Process for list
        const processedClients = filteredLinkedClients.map(client => {
          let date: Date | null = null;
          const dateVal = client.lastTelegramLinkDate;

          if (dateVal && typeof dateVal === 'object' && 'seconds' in dateVal) {
            date = new Date(dateVal.seconds * 1000);
          } else if (dateVal instanceof Date) {
            date = dateVal;
          } else if (typeof dateVal === 'string') {
            date = new Date(dateVal);
          }

          return {
            ...client,
            normalizedDate: date
          };
        }).sort((a, b) => {
          if (!a.normalizedDate || !b.normalizedDate) return 0;
          return b.normalizedDate.getTime() - a.normalizedDate.getTime();
        });

        setLinkedClients(processedClients);

        // Group by date for chart
        const grouped = filteredLinkedClients.reduce((acc: any, client) => {
          let dateStr = '';
          const dateVal = client.lastTelegramLinkDate;
          let date: Date | null = null;

          if (dateVal && typeof dateVal === 'object' && 'seconds' in dateVal) {
            date = new Date(dateVal.seconds * 1000);
          } else if (dateVal instanceof Date) {
            date = dateVal;
          } else if (typeof dateVal === 'string') {
            date = new Date(dateVal);
          }

          if (date && !isNaN(date.getTime())) {
            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            dateStr = `${day}/${month}`;
          } else {
            return acc;
          }

          if (!acc[dateStr]) {
            acc[dateStr] = 0;
          }
          acc[dateStr]++;
          return acc;
        }, {});

        const formattedData = Object.keys(grouped).map(key => ({
          date: key,
          count: grouped[key]
        })).sort((a, b) => {
          const [dayA, monthA] = a.date.split('/').map(Number);
          const [dayB, monthB] = b.date.split('/').map(Number);
          if (isNaN(dayA) || isNaN(monthA) || isNaN(dayB) || isNaN(monthB)) return 0;
          return (monthA * 31 + dayA) - (monthB * 31 + dayB);
        });

        setTelegramChartData(formattedData);
      } catch (error) {
        console.error('Error fetching telegram stats:', error);
      }
    };

    if (activeTab === 'general') {
      fetchTelegramData();
    }
  }, [activeTab]);

  const loadData = async () => {
    try {
      setLoading(true)

      // Cargar todos los pedidos y negocios con manejo de errores mejorado
      const allBusinesses = await getAllBusinesses()
      // Filtrar negocios válidos y calcular estado real
      const validBusinesses = allBusinesses
        .filter(business => business && business.id && business.name)
        .map(b => ({
          ...b,
          isOpen: isStoreOpen(b) // Calcular estado real basado en horario/manual
        }))
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
      const [allCredits, allLinks, allGlobalClients, allDeliveries] = await Promise.all([
        getAllUserCreditsGlobal(),
        getAllReferralLinksGlobal(),
        getAllClientsGlobal(),
        getAllDeliveries()
      ])
      setDeliveries(allDeliveries)

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
          image: globalClient?.photoURL || null,
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

  // ── WALLET CREDIT HANDLER ──────────────────────────────────────────────────
  const handleCreditWallet = async () => {
    setWalletMessage(null)
    const { phone, amount, concept } = walletForm

    if (!phone.trim()) return setWalletMessage({ type: 'error', text: 'Ingresa un número de celular.' })
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
      return setWalletMessage({ type: 'error', text: 'Ingresa un monto válido mayor a 0.' })
    if (!concept.trim()) return setWalletMessage({ type: 'error', text: 'Ingresa un concepto.' })

    const normalizedPhone = normalizeEcuadorianPhone(phone.trim())

    setWalletLoading(true)
    try {
      // Buscar el cliente para obtener su ID real
      const allClients = await getAllClientsGlobal()
      const client = allClients.find(
        c => normalizeEcuadorianPhone(c.celular || '') === normalizedPhone
      )

      const userId = client?.id || normalizedPhone // fallback: usar el teléfono normalizado como userId

      // Usar el primer negocio disponible o 'global' si no hay negocios
      const businessId = businesses[0]?.id || 'global'

      await addWalletBalance(
        userId,
        businessId,
        Number(amount),
        concept.trim(),
        'admin' // createdBy
      )

      setWalletMessage({
        type: 'success',
        text: `✅ Se acreditaron $${Number(amount).toFixed(2)} a ${client?.nombres || normalizedPhone} correctamente.`
      })
      setWalletForm({ phone: '', amount: '', concept: '' })
    } catch (err) {
      console.error('Error crediting wallet:', err)
      setWalletMessage({ type: 'error', text: 'Ocurrió un error al acreditar el saldo.' })
    } finally {
      setWalletLoading(false)
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

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

  const renderOrdersHistoryTab = () => {
    // Aplicar filtros a las órdenes
    let filteredOrders = orders.filter(order => {
      // Filtro por tienda
      if (filterOrdersBusiness !== 'all' && order.businessId !== filterOrdersBusiness) {
        return false;
      }

      // Filtro por tipo de entrega
      if (filterOrdersDeliveryType !== 'all') {
        const deliveryType = order.delivery?.type || 'pickup';
        if (filterOrdersDeliveryType === 'delivery' && deliveryType !== 'delivery') {
          return false;
        }
        if (filterOrdersDeliveryType === 'pickup' && deliveryType !== 'pickup') {
          return false;
        }
      }

      // Filtro por rango de fechas
      if (order.createdAt) {
        try {
          const orderDate = new Date(order.createdAt);
          const startDate = new Date(filterOrdersDateRange.start);
          const endDate = new Date(filterOrdersDateRange.end);

          startDate.setHours(0, 0, 0, 0);
          endDate.setHours(23, 59, 59, 999);

          if (orderDate < startDate || orderDate > endDate) {
            return false;
          }
        } catch (e) {
          return false;
        }
      }

      return true;
    });

    // Ordenar por fecha descendente
    filteredOrders = filteredOrders.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    // Calcular estadísticas de órdenes filtradas
    const totalOrders = filteredOrders.length;
    const totalRevenue = filteredOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    const deliveryOrders = filteredOrders.filter(o => o.delivery?.type === 'delivery').length;
    const pickupOrders = filteredOrders.filter(o => o.delivery?.type !== 'delivery').length;

    const statusConfig: Record<string, { bg: string; text: string; icon: string }> = {
      pending: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'bi-clock-history' },
      confirmed: { bg: 'bg-blue-50', text: 'text-blue-700', icon: 'bi-check2-circle' },
      preparing: { bg: 'bg-orange-50', text: 'text-orange-700', icon: 'bi-fire' },
      ready: { bg: 'bg-green-50', text: 'text-green-700', icon: 'bi-bag-check' },
      delivered: { bg: 'bg-gray-50', text: 'text-gray-600', icon: 'bi-house-check' },
      cancelled: { bg: 'bg-red-50', text: 'text-red-700', icon: 'bi-x-circle' }
    };

    return (
      <div className="space-y-6">
        {/* Tarjetas de estadísticas */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className="bg-white rounded-lg shadow-sm p-3 md:p-4 border border-gray-200">
            <p className="text-xs md:text-sm font-medium text-gray-500">Órdenes</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900 mt-1">{totalOrders}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-3 md:p-4 border border-gray-200">
            <p className="text-xs md:text-sm font-medium text-gray-500">Ingresos</p>
            <p className="text-xl md:text-2xl font-bold text-green-600 mt-1">${totalRevenue.toFixed(0)}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-3 md:p-4 border border-gray-200">
            <p className="text-xs md:text-sm font-medium text-gray-500">Delivery</p>
            <p className="text-xl md:text-2xl font-bold text-blue-600 mt-1">{deliveryOrders}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-3 md:p-4 border border-gray-200">
            <p className="text-xs md:text-sm font-medium text-gray-500">Retiro</p>
            <p className="text-xl md:text-2xl font-bold text-purple-600 mt-1">{pickupOrders}</p>
          </div>
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Filtros</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Filtro de Tienda */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tienda</label>
              <select
                value={filterOrdersBusiness}
                onChange={(e) => setFilterOrdersBusiness(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">Todas las tiendas</option>
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>
                    {business.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Filtro de Tipo de Entrega */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Entrega</label>
              <select
                value={filterOrdersDeliveryType}
                onChange={(e) => setFilterOrdersDeliveryType(e.target.value as 'all' | 'delivery' | 'pickup')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">Todos</option>
                <option value="delivery">Delivery</option>
                <option value="pickup">Retiro en tienda</option>
              </select>
            </div>

            {/* Filtro de Rango de Fechas */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Rango de Fechas</label>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={filterOrdersDateRange.start}
                  onChange={(e) =>
                    setFilterOrdersDateRange((prev) => ({
                      ...prev,
                      start: e.target.value,
                    }))
                  }
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-gray-400">a</span>
                <input
                  type="date"
                  value={filterOrdersDateRange.end}
                  onChange={(e) =>
                    setFilterOrdersDateRange((prev) => ({
                      ...prev,
                      end: e.target.value,
                    }))
                  }
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Tabla de Órdenes */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 md:p-6 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900">Historial de Órdenes</h3>
            <p className="text-sm text-gray-500 mt-1">
              Mostrando {filteredOrders.length} de {orders.length} órdenes
            </p>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="p-8 text-center">
              <i className="bi bi-inbox text-4xl text-gray-300 mb-3 block"></i>
              <p className="text-gray-500 font-medium">No hay órdenes que coincidan con los filtros seleccionados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID Orden</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tienda</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo</th>
                    <th className="px-4 md:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredOrders.map((order) => {
                    const business = businesses.find((b) => b.id === order.businessId);
                    const deliveryType = order.delivery?.type === 'delivery' ? 'Delivery' : 'Retiro';
                    const status = statusConfig[order.status] || statusConfig.pending;

                    return (
                      <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 md:px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">
                          {order.id.slice(0, 8)}...
                        </td>
                        <td className="px-4 md:px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {business?.name || 'N/A'}
                        </td>
                        <td className="px-4 md:px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{order.customer?.name || 'Sin nombre'}</div>
                          <div className="text-xs text-gray-500">{order.customer?.phone || 'Sin teléfono'}</div>
                        </td>
                        <td className="px-4 md:px-6 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium ${deliveryType === 'Delivery'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-purple-50 text-purple-700'
                              }`}
                          >
                            <i
                              className={`bi ${deliveryType === 'Delivery' ? 'bi-scooter' : 'bi-house-door'
                                }`}
                            ></i>
                            {deliveryType}
                          </span>
                        </td>
                        <td className="px-4 md:px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-gray-900">
                          ${order.total?.toFixed(2) || '0.00'}
                        </td>
                        <td className="px-4 md:px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
                            <i className={`bi ${status.icon}`}></i>
                            {order.status === 'pending'
                              ? 'Pendiente'
                              : order.status === 'confirmed'
                                ? 'Confirmado'
                                : order.status === 'preparing'
                                  ? 'Preparando'
                                  : order.status === 'ready'
                                    ? 'Listo'
                                    : order.status === 'delivered'
                                      ? 'Entregado'
                                      : 'Cancelado'}
                          </span>
                        </td>
                        <td className="px-4 md:px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.createdAt
                            ? new Date(order.createdAt).toLocaleDateString('es-EC', {
                              day: '2-digit',
                              month: '2-digit',
                              year: '2-digit',
                            })
                            : 'Sin fecha'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderRecommendersTab = () => {
    return (
      <div className="space-y-6">
        {/* ACREDITAR SALDO */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
              <i className="bi bi-wallet2 text-lg"></i>
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Acreditar Saldo</h3>
              <p className="text-xs text-gray-500">Acredita saldo manualmente a la billetera de un usuario</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
                Celular del usuario
              </label>
              <input
                type="tel"
                placeholder="0990000000 o +593 99 000 0000"
                value={walletForm.phone}
                onChange={e => setWalletForm(prev => ({ ...prev, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
                Monto ($)
              </label>
              <input
                type="number"
                placeholder="0.00"
                min="0.01"
                step="0.01"
                value={walletForm.amount}
                onChange={e => setWalletForm(prev => ({ ...prev, amount: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
                Concepto
              </label>
              <input
                type="text"
                placeholder="Ej: Devolución entrega fallida"
                value={walletForm.concept}
                onChange={e => setWalletForm(prev => ({ ...prev, concept: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {walletMessage && (
            <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${walletMessage.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
              {walletMessage.text}
            </div>
          )}

          <button
            onClick={handleCreditWallet}
            disabled={walletLoading}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {walletLoading ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                Acreditando...
              </>
            ) : (
              <>
                <i className="bi bi-plus-circle"></i>
                Acreditar Saldo
              </>
            )}
          </button>
        </div>

        {/* TOP RECOMENDADORES */}
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
            onClick={() => setActiveTab('home')}
            className={`flex-shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'home' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <i className="bi bi-house md:hidden me-1.5"></i>
            Inicio
          </button>
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
          <button
            onClick={() => setActiveTab('templates')}
            className={`flex-shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'templates' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <i className="bi bi-chat-left-text md:hidden me-1.5"></i>
            Plantillas
          </button>
          <button
            onClick={() => setActiveTab('products')}
            className={`flex-shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'products' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <i className="bi bi-box-seam md:hidden me-1.5"></i>
            Productos
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`flex-shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'orders' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <i className="bi bi-receipt md:hidden me-1.5"></i>
            Historial
          </button>
        </div>
      </div>

      {activeTab === 'home' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {businesses.map((business) => {
              // Calcular contadores de órdenes para este negocio filtrado por fecha
              const businessOrders = orders.filter(o => {
                try {
                  return o.businessId === business.id &&
                    o.createdAt &&
                    new Date(o.createdAt).toISOString().startsWith(selectedDate);
                } catch (e) {
                  return false;
                }
              });
              const activeOrders = businessOrders.filter(o => ['pending', 'confirmed', 'preparing', 'ready', 'on_way'].includes(o.status)).length;
              const deliveredOrders = businessOrders.filter(o => o.status === 'delivered').length;

              return (
                <a
                  key={business.id}
                  href={`/business/${business.username || business.id}/dashboard`}
                  className="bg-white rounded-xl p-4 shadow-sm border border-gray-200 flex items-center gap-4 hover:shadow-md transition-all group cursor-pointer"
                >
                  <div className="w-16 h-16 rounded-full border border-gray-100 bg-gray-50 overflow-hidden flex-shrink-0">
                    {business.image ? (
                      <img src={business.image} alt={business.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <i className="bi bi-shop text-gray-400 text-xl"></i>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col flex-1 min-w-0">
                    <h3 className="text-base font-bold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                      {business.name}
                    </h3>

                    <div className={`mt-1 inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full w-fit ${business.isOpen
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-gray-50 text-gray-500 border border-gray-200'
                      }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${business.isOpen ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                      {business.isOpen ? 'Abierto' : 'Cerrado'}
                    </div>

                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Activas</span>
                        <span className="text-sm font-bold text-gray-900">{activeOrders}</span>
                      </div>
                      <div className="w-px h-6 bg-gray-100"></div>
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Entregadas</span>
                        <span className="text-sm font-bold text-gray-900">{deliveredOrders}</span>
                      </div>
                    </div>
                  </div>
                </a>
              );
            })}
            {businesses.length === 0 && !loading && (
              <div className="col-span-full py-12 text-center">
                <div className="inline-block p-4 rounded-full bg-gray-50 mb-4">
                  <i className="bi bi-shop text-4xl text-gray-300"></i>
                </div>
                <h3 className="text-lg font-medium text-gray-900">No hay tiendas registradas</h3>
                <p className="text-gray-500">Comienza creando tu primera tienda.</p>
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'general' ? (
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
            <a
              href="/admin/products"
              className="flex-shrink-0 w-36 md:w-auto bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl shadow-sm p-4 md:p-6 border border-indigo-200 hover:shadow-md active:scale-[0.98] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-indigo-700">Productos</p>
                  <p className="text-[11px] text-indigo-600 mt-0.5">Comisiones</p>
                </div>
                <i className="bi bi-box-seam text-xl md:text-2xl text-indigo-600"></i>
              </div>
            </a>
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Telegram Chart */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200 lg:col-span-2">
              <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900">Vinculaciones de Telegram</h3>
                <p className="text-sm text-gray-500">Usuarios que han activado notificaciones</p>
              </div>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={telegramChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
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
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      cursor={{ fill: '#f3f4f6' }}
                    />
                    <Bar
                      dataKey="count"
                      name="Usuarios"
                      fill="#0ea5e9"
                      radius={[4, 4, 0, 0]}
                      barSize={30}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Lista de Clientes Vinculados */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 lg:col-span-2 overflow-hidden">
              <div className="p-6 border-b border-gray-100">
                <h3 className="text-lg font-bold text-gray-900">Clientes Vinculados recientemente</h3>
                <p className="text-sm text-gray-500">Listado de usuarios con Telegram activo</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Teléfono</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {linkedClients.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-6 py-10 text-center text-gray-500">
                          No hay clientes vinculados aún.
                        </td>
                      </tr>
                    ) : (
                      linkedClients.slice(0, 10).map((client, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                <i className="bi bi-person"></i>
                              </div>
                              <div className="text-sm font-bold text-gray-900">{client.nombres || 'Usuario'}</div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {client.celular}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {client.normalizedDate?.toLocaleDateString()} {client.normalizedDate?.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

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
      ) : activeTab === 'templates' ? (
        <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>}>
          <TelegramTemplateEditor />
        </Suspense>
      ) : activeTab === 'products' ? (
        <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>}>
          <ProductsList />
        </Suspense>
      ) : activeTab === 'orders' ? (
        renderOrdersHistoryTab()
      ) : (
        renderRecommendersTab()
      )}
    </div>
  );
}
