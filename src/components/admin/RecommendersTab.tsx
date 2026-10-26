'use client'

import { useState } from 'react'
import { normalizeEcuadorianPhone } from '@/lib/validation'
import { getAllClientsGlobal, addWalletBalance, getUserReferrals, getOrdersByReferralCode } from '@/lib/database'
import { Business, Order } from '@/types'

interface RecommendersTabProps {
  customers: any[]
  globalClients: any[]
  recommenders: any[]
  businesses: Business[]
  allReferralLinks?: any[]
  orders?: Order[]
}

export default function RecommendersTab({
  customers,
  globalClients,
  recommenders,
  businesses,
  allReferralLinks = [],
  orders = []
}: RecommendersTabProps) {
  // FORMULARIO ACREDITAR SALDO
  const [walletForm, setWalletForm] = useState({ phone: '', amount: '', concept: '' })
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletMessage, setWalletMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ESTADOS DE DESPLIEGUE ANIDADO
  // Nivel 1: Clientes expandidos
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({})
  // Caché de links por cliente
  const [clientLinksState, setClientLinksState] = useState<Record<string, { loading: boolean; links: any[] }>>({})

  // Nivel 2: Productos expandidos para ver quién compró
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({})
  // Caché de compradores por código de link
  const [productOrdersState, setProductOrdersState] = useState<Record<string, { loading: boolean; orders: any[] }>>({})

  // BÚSQUEDA Y FEEDBACK
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // MODAL ALTERNATIVO (mantenido por compatibilidad)
  const [linksModal, setLinksModal] = useState<{ open: boolean; userName: string; userPhone: string }>({ open: false, userName: '', userPhone: '' })
  const [userModalLinks, setUserModalLinks] = useState<any[]>([])
  const [modalLoading, setModalLoading] = useState(false)
  const [modalExpandedLink, setModalExpandedLink] = useState<string | null>(null)
  const [modalLinkSales, setModalLinkSales] = useState<any[]>([])
  const [modalSalesLoading, setModalSalesLoading] = useState(false)

  // MANEJO DE ACREDITAR SALDO
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
      const allClients = await getAllClientsGlobal()
      const client = allClients.find(
        c => normalizeEcuadorianPhone(c.celular || '') === normalizedPhone
      )

      const userId = client?.id || normalizedPhone
      const businessId = businesses[0]?.id || 'global'

      await addWalletBalance(
        userId,
        businessId,
        Number(amount),
        concept.trim(),
        'admin'
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

  // Nombre detectado al tipear celular en el formulario
  const normalizedWalletPhone = walletForm.phone ? normalizeEcuadorianPhone(walletForm.phone.trim()) : ''
  const foundClientName = normalizedWalletPhone ? (
    globalClients.find(c => c.celular && normalizeEcuadorianPhone(c.celular) === normalizedWalletPhone)?.nombres ||
    customers.find(c => c.phone && normalizeEcuadorianPhone(c.phone) === normalizedWalletPhone)?.name
  ) : null

  // DESPLEGAR CLIENTE (Nivel 1 -> Nivel 2)
  const handleToggleClient = async (recommender: any) => {
    const clientKey = recommender.phone || recommender.id || recommender.userId
    const isCurrentlyExpanded = Boolean(expandedClients[clientKey])
    const willExpand = !isCurrentlyExpanded

    setExpandedClients(prev => ({
      ...prev,
      [clientKey]: willExpand
    }))

    // Si vamos a expandir y aún no tenemos sus links en caché, cargarlos
    if (willExpand && !clientLinksState[clientKey]) {
      const possibleIds = Array.from(new Set([
        recommender.phone,
        recommender.userId,
        recommender.id,
        normalizeEcuadorianPhone(recommender.phone || ''),
        normalizeEcuadorianPhone(recommender.userId || '')
      ].filter(Boolean))) as string[]

      // Intentar primero desde allReferralLinks precargados
      let matchedLinks: any[] = []
      if (allReferralLinks && allReferralLinks.length > 0) {
        matchedLinks = allReferralLinks.filter(l => {
          if (!l.createdBy) return false
          const normCreated = normalizeEcuadorianPhone(l.createdBy)
          return possibleIds.some(pid => pid === l.createdBy || (normCreated && normCreated === normalizeEcuadorianPhone(pid)))
        })
      }

      if (matchedLinks.length > 0) {
        // Ordenar por conversiones y luego fecha
        matchedLinks.sort((a, b) => (b.conversions || 0) - (a.conversions || 0))
        setClientLinksState(prev => ({
          ...prev,
          [clientKey]: { loading: false, links: matchedLinks }
        }))
      } else {
        // Consultar de Firestore
        setClientLinksState(prev => ({
          ...prev,
          [clientKey]: { loading: true, links: [] }
        }))

        try {
          const fetched = await getUserReferrals(possibleIds)
          setClientLinksState(prev => ({
            ...prev,
            [clientKey]: { loading: false, links: fetched }
          }))
        } catch (err) {
          console.error('Error fetching referrals for client:', err)
          setClientLinksState(prev => ({
            ...prev,
            [clientKey]: { loading: false, links: [] }
          }))
        }
      }
    }
  }

  // DESPLEGAR PRODUCTO RECOMENDADO (Nivel 2 -> Nivel 3: Quién lo compró)
  const handleToggleProductOrders = async (link: any) => {
    const code = link.code
    if (!code) return

    const isCurrentlyExpanded = Boolean(expandedProducts[code])
    const willExpand = !isCurrentlyExpanded

    setExpandedProducts(prev => ({
      ...prev,
      [code]: willExpand
    }))

    // Si vamos a expandir y no tenemos los compradores en caché, cargarlos
    if (willExpand && !productOrdersState[code]) {
      setProductOrdersState(prev => ({
        ...prev,
        [code]: { loading: true, orders: [] }
      }))

      try {
        // 1. Obtener órdenes de Firestore con este código
        const dbOrders = await getOrdersByReferralCode(code)

        // 2. Órdenes locales de la sesión
        const localMatches = (orders || []).filter(o => o.referralCode === code)

        // Unificar órdenes por ID
        const unifiedMap = new Map<string, any>()
        dbOrders.forEach(o => unifiedMap.set(o.id, o))
        localMatches.forEach(o => {
          if (!unifiedMap.has(o.id)) unifiedMap.set(o.id, o)
        })

        const finalOrders = Array.from(unifiedMap.values())
        finalOrders.sort((a, b) => {
          const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : a.createdAt ? new Date(a.createdAt) : new Date(0)
          const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : b.createdAt ? new Date(b.createdAt) : new Date(0)
          return dateB.getTime() - dateA.getTime()
        })

        setProductOrdersState(prev => ({
          ...prev,
          [code]: { loading: false, orders: finalOrders }
        }))
      } catch (err) {
        console.error('Error fetching buyers for referral code:', code, err)
        setProductOrdersState(prev => ({
          ...prev,
          [code]: { loading: false, orders: [] }
        }))
      }
    }
  }

  // COPIAR LINK AL PORTAPAPELES
  const handleCopyLink = (link: any) => {
    if (!link.code) return
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://fuddi.shop'
    const bizUsername = link.businessUsername || ''
    const pSlug = link.productSlug || link.productId || ''
    const url = bizUsername && pSlug
      ? `${origin}/${bizUsername}/${pSlug}?ref=${link.code}`
      : `${origin}/?ref=${link.code}`

    navigator.clipboard.writeText(url).then(() => {
      setCopiedCode(link.code)
      setTimeout(() => setCopiedCode(null), 2000)
    }).catch(err => {
      console.error('Error copying referral link:', err)
    })
  }

  // MODAL HANDLERS (COMPATIBILIDAD)
  const handleOpenModal = async (phone: string, name: string) => {
    setLinksModal({ open: true, userName: name, userPhone: phone })
    setModalLoading(true)
    setUserModalLinks([])
    setModalExpandedLink(null)
    setModalLinkSales([])
    try {
      const links = await getUserReferrals(phone)
      setUserModalLinks(links || [])
    } catch (err) {
      console.error('Error fetching user links in modal:', err)
    } finally {
      setModalLoading(false)
    }
  }

  const handleToggleModalLinkSales = async (linkId: string, code: string) => {
    if (modalExpandedLink === linkId) {
      setModalExpandedLink(null)
      setModalLinkSales([])
      return
    }
    setModalExpandedLink(linkId)
    setModalSalesLoading(true)
    setModalLinkSales([])
    try {
      const ordersRes = await getOrdersByReferralCode(code)
      setModalLinkSales(ordersRes)
    } catch (err) {
      console.error('Error fetching modal link sales:', err)
    } finally {
      setModalSalesLoading(false)
    }
  }

  // FORMATEADOR DE FECHAS
  const formatDate = (rawDate: any) => {
    if (!rawDate) return 'N/A'
    try {
      const date = rawDate.toDate ? rawDate.toDate() : new Date(rawDate)
      return date.toLocaleDateString('es-EC', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return 'N/A'
    }
  }

  // BADGE DE ESTADO DE ORDEN
  const getOrderStatusBadge = (status: string) => {
    switch (status) {
      case 'delivered':
        return {
          label: 'Entregada',
          icon: 'bi-check-circle-fill',
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
        }
      case 'on_way':
        return {
          label: 'En camino',
          icon: 'bi-bicycle',
          bg: 'bg-blue-50 text-blue-700 border-blue-200/80'
        }
      case 'preparing':
        return {
          label: 'Preparando',
          icon: 'bi-hourglass-split',
          bg: 'bg-amber-50 text-amber-700 border-amber-200/80'
        }
      case 'confirmed':
        return {
          label: 'Confirmada',
          icon: 'bi-check2',
          bg: 'bg-indigo-50 text-indigo-700 border-indigo-200/80'
        }
      case 'ready':
        return {
          label: 'Lista',
          icon: 'bi-box-seam',
          bg: 'bg-teal-50 text-teal-700 border-teal-200/80'
        }
      case 'cancelled':
        return {
          label: 'Cancelada',
          icon: 'bi-x-circle-fill',
          bg: 'bg-rose-50 text-rose-700 border-rose-200/80'
        }
      default:
        return {
          label: 'Pendiente',
          icon: 'bi-clock-fill',
          bg: 'bg-yellow-50 text-yellow-700 border-yellow-200/80'
        }
    }
  }

  // FILTRADO DE RECOMENDADORES
  const filteredRecommenders = recommenders.filter(r => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    const nameMatch = (r.name || '').toLowerCase().includes(q)
    const phoneMatch = (r.phone || '').toLowerCase().includes(q)
    return nameMatch || phoneMatch
  })

  // TOTALES GENERALES
  const totalCreatedLinks = recommenders.reduce((sum, r) => sum + (r.linksCount || 0), 0)
  const totalSalesCount = recommenders.reduce((sum, r) => sum + (r.conversions || 0), 0)
  const totalClicksCount = recommenders.reduce((sum, r) => sum + (r.clicks || 0), 0)

  return (
    <div className="space-y-6">
      {/* SECCIÓN: ACREDITAR SALDO */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 p-5 sm:p-6 transition-all">
        <div className="flex items-center gap-3.5 mb-5">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm">
            <i className="bi bi-wallet2 text-lg"></i>
          </div>
          <div>
            <h3 className="text-base font-black text-gray-900 tracking-tight leading-tight">Acreditar Saldo</h3>
            <p className="text-xs font-medium text-gray-500 leading-relaxed">Acredita saldo manualmente a la billetera de un usuario</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wider">
              Celular del usuario
            </label>
            <input
              type="tel"
              placeholder="0990000000 o +593 99 000 0000"
              value={walletForm.phone}
              onChange={e => setWalletForm(prev => ({ ...prev, phone: e.target.value }))}
              className="w-full px-3.5 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
            {walletForm.phone.trim() !== '' && (
              <div className="mt-1.5 text-xs font-medium">
                {foundClientName ? (
                  <span className="text-emerald-700 flex items-center gap-1.5 bg-emerald-50 px-2 py-0.5 rounded-md w-fit">
                    <i className="bi bi-person-check-fill text-emerald-600"></i> {foundClientName}
                  </span>
                ) : (
                  <span className="text-amber-700 flex items-center gap-1.5 bg-amber-50 px-2 py-0.5 rounded-md w-fit">
                    <i className="bi bi-info-circle text-amber-600"></i> Usuario no registrado
                  </span>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wider">
              Monto ($)
            </label>
            <input
              type="number"
              placeholder="0.00"
              min="0.01"
              step="0.01"
              value={walletForm.amount}
              onChange={e => setWalletForm(prev => ({ ...prev, amount: e.target.value }))}
              className="w-full px-3.5 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wider">
              Concepto
            </label>
            <input
              type="text"
              placeholder="Ej: Devolución entrega fallida"
              value={walletForm.concept}
              onChange={e => setWalletForm(prev => ({ ...prev, concept: e.target.value }))}
              className="w-full px-3.5 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
          </div>
        </div>

        {walletMessage && (
          <div className={`mb-4 p-3.5 rounded-xl text-sm font-medium border flex items-center gap-2 ${
            walletMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}>
            <i className={`bi ${walletMessage.type === 'success' ? 'bi-check-circle-fill text-emerald-600' : 'bi-exclamation-triangle-fill text-rose-600'}`}></i>
            {walletMessage.text}
          </div>
        )}

        <button
          onClick={handleCreditWallet}
          disabled={walletLoading}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-black transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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

      {/* SECCIÓN PRINCIPAL: CLIENTES RECOMENDADORES */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 overflow-hidden">
        {/* Cabecera y Resumen */}
        <div className="p-5 sm:p-6 border-b border-gray-100 bg-gradient-to-b from-gray-50/50 to-white">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-lg font-black text-gray-900 tracking-tight leading-tight">Clientes Recomendadores</h3>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                  {filteredRecommenders.length} usuarios
                </span>
              </div>
              <p className="text-xs font-medium text-gray-500 leading-relaxed mt-0.5">
                Despliega un cliente para ver sus productos recomendados y despliega cada producto para ver quién lo compró.
              </p>
            </div>

            {/* Buscador */}
            <div className="relative w-full md:w-72">
              <i className="bi bi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
              <input
                type="text"
                placeholder="Buscar por cliente o celular..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  <i className="bi bi-x-circle-fill"></i>
                </button>
              )}
            </div>
          </div>

          {/* Tarjetas de Métricas Rápidas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-gray-100">
            <div className="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Recomendadores</span>
              <span className="text-base font-black text-gray-900 tracking-tight">{recommenders.length}</span>
            </div>
            <div className="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Links Creados</span>
              <span className="text-base font-black text-gray-900 tracking-tight">{totalCreatedLinks}</span>
            </div>
            <div className="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Clicks Totales</span>
              <span className="text-base font-black text-gray-900 tracking-tight">{totalClicksCount}</span>
            </div>
            <div className="bg-rose-50/60 rounded-xl p-3 border border-rose-100">
              <span className="text-[11px] font-bold text-rose-500 uppercase tracking-wider block">Ventas Generadas</span>
              <span className="text-base font-black text-rose-700 tracking-tight">{totalSalesCount} compras</span>
            </div>
          </div>
        </div>

        {/* LISTA DESPLEGABLE DE CLIENTES */}
        <div className="divide-y divide-gray-100">
          {filteredRecommenders.map((recommender) => {
            const clientKey = recommender.phone || recommender.id || recommender.userId
            const isExpanded = Boolean(expandedClients[clientKey])
            const clientLinksData = clientLinksState[clientKey]
            const clientLinks = clientLinksData?.links || []
            const isLoadingLinks = clientLinksData?.loading || false

            return (
              <div key={clientKey} className="transition-colors">
                {/* FILA DEL CLIENTE (Nivel 1) */}
                <div
                  onClick={() => handleToggleClient(recommender)}
                  className={`p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer select-none transition-colors ${
                    isExpanded ? 'bg-indigo-50/30' : 'hover:bg-gray-50/80'
                  }`}
                >
                  {/* Datos del Cliente */}
                  <div className="flex items-center gap-3.5 min-w-0">
                    <button
                      type="button"
                      aria-label={isExpanded ? 'Colapsar cliente' : 'Desplegar cliente'}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-all flex-shrink-0 ${
                        isExpanded
                          ? 'bg-indigo-600 text-white border-indigo-600 rotate-90 shadow-sm'
                          : 'bg-white text-gray-400 border-gray-200 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <i className="bi bi-chevron-right text-xs"></i>
                    </button>

                    <div className="w-11 h-11 bg-gray-100 rounded-full overflow-hidden border border-gray-200 flex items-center justify-center flex-shrink-0 shadow-inner">
                      {recommender.image ? (
                        <img
                          src={recommender.image}
                          alt={recommender.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(recommender.name)}&background=random`
                          }}
                        />
                      ) : (
                        <i className="bi bi-person text-xl text-gray-400"></i>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-black text-gray-900 tracking-tight leading-tight truncate">
                          {recommender.name}
                        </h4>
                        {recommender.conversions > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            <i className="bi bi-fire"></i> {recommender.conversions} ventas
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-medium text-gray-500 leading-relaxed truncate">
                        {recommender.phone || 'Sin celular'}
                      </p>
                    </div>
                  </div>

                  {/* Métricas y Acción */}
                  <div className="flex items-center justify-between md:justify-end gap-3 flex-wrap pl-11 md:pl-0">
                    {/* Clics */}
                    <div className="text-left md:text-right">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Visitas</span>
                      <span className="text-xs font-bold text-gray-700">{recommender.clicks || 0} clicks</span>
                    </div>

                    {/* Créditos */}
                    <div className="text-left md:text-right border-l border-gray-200 pl-3">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Créditos</span>
                      <div className="text-xs font-bold text-gray-900">${recommender.totalCredits?.toFixed(2) || '0.00'}</div>
                      <div className="text-[10px] font-semibold text-emerald-600">Disp: ${recommender.credits?.toFixed(2) || '0.00'}</div>
                    </div>

                    {/* Botón Desplegable */}
                    <div className="flex items-center gap-2 ml-2">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                        isExpanded
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                      }`}>
                        <i className={`bi bi-${isExpanded ? 'folder2-open' : 'folder2'}`}></i>
                        {recommender.linksCount || 0} productos
                        <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-[10px]`}></i>
                      </span>
                    </div>
                  </div>
                </div>

                {/* CONTENIDO DESPLEGADO DEL CLIENTE (Nivel 2: Productos recomendados) */}
                {isExpanded && (
                  <div className="bg-gradient-to-b from-indigo-50/20 via-gray-50/40 to-white px-4 py-5 sm:px-8 border-t border-indigo-100/60 transition-all">
                    <div className="max-w-5xl mx-auto space-y-4">
                      {/* Sub-cabecera */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <i className="bi bi-box2-heart text-indigo-600 text-sm"></i>
                          <h5 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                            Productos recomendados por {recommender.name}
                          </h5>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleOpenModal(recommender.phone, recommender.name)
                          }}
                          className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <i className="bi bi-box-arrow-up-right"></i> Ver en modal
                        </button>
                      </div>

                      {/* Estado de carga de links */}
                      {isLoadingLinks ? (
                        <div className="bg-white rounded-xl border border-gray-200/80 p-8 flex items-center justify-center gap-3">
                          <div className="animate-spin h-5 w-5 border-2 border-indigo-600 border-t-transparent rounded-full"></div>
                          <span className="text-xs font-medium text-gray-500">Cargando productos recomendados...</span>
                        </div>
                      ) : clientLinks.length > 0 ? (
                        <div className="space-y-3">
                          {clientLinks.map((link) => {
                            const isProductExpanded = Boolean(expandedProducts[link.code])
                            const productOrdersData = productOrdersState[link.code]
                            const productOrders = productOrdersData?.orders || []
                            const isLoadingOrders = productOrdersData?.loading || false
                            const hasSales = (link.conversions || 0) > 0

                            return (
                              <div
                                key={link.id || link.code}
                                className={`bg-white rounded-xl border transition-all overflow-hidden ${
                                  isProductExpanded
                                    ? 'border-indigo-300 shadow-sm ring-1 ring-indigo-200/50'
                                    : 'border-gray-200/90 hover:border-gray-300 shadow-xs'
                                }`}
                              >
                                {/* FILA DEL PRODUCTO (Nivel 2) */}
                                <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                  {/* Info del Producto */}
                                  <div className="flex items-start gap-3.5 min-w-0 flex-1">
                                    <div className="w-14 h-14 rounded-xl bg-gray-50 border border-gray-200 overflow-hidden flex-shrink-0 shadow-inner flex items-center justify-center">
                                      {link.productImage ? (
                                        <img
                                          src={link.productImage}
                                          alt={link.productName || 'Producto'}
                                          className="w-full h-full object-cover"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).src = 'https://placehold.co/100x100?text=Producto'
                                          }}
                                        />
                                      ) : (
                                        <i className="bi bi-bag text-gray-400 text-xl"></i>
                                      )}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                      <h6 className="text-sm font-black text-gray-900 tracking-tight leading-tight truncate">
                                        {link.productName || 'Producto sin nombre'}
                                      </h6>
                                      {link.businessName && (
                                        <p className="text-xs font-medium text-gray-500 leading-relaxed truncate mt-0.5">
                                          <i className="bi bi-shop text-[11px] mr-1 text-gray-400"></i>
                                          {link.businessName}
                                        </p>
                                      )}
                                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-gray-100 text-[11px] font-mono font-semibold text-gray-700">
                                          <i className="bi bi-link-45deg text-gray-400"></i>
                                          {link.code}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => handleCopyLink(link)}
                                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border transition-all cursor-pointer flex items-center gap-1 ${
                                            copiedCode === link.code
                                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                          }`}
                                          title="Copiar link completo de recomendación"
                                        >
                                          <i className={`bi bi-${copiedCode === link.code ? 'check' : 'clipboard'}`}></i>
                                          {copiedCode === link.code ? '¡Copiado!' : 'Copiar link'}
                                        </button>
                                        <span className="text-[11px] font-medium text-gray-400">
                                          Creado: {formatDate(link.createdAt)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Métricas y Botón Desplegar Compradores */}
                                  <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 pt-3 sm:pt-0 border-gray-100">
                                    <div className="bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-100 text-center">
                                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Visitas</span>
                                      <span className="text-xs font-bold text-gray-800">{link.clicks || 0}</span>
                                    </div>

                                    {/* Botón para Desplegar Compradores */}
                                    <button
                                      type="button"
                                      onClick={() => handleToggleProductOrders(link)}
                                      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-xs ${
                                        isProductExpanded
                                          ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                                          : hasSales
                                          ? 'bg-rose-50 text-rose-700 border-rose-200/80 hover:bg-rose-100'
                                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                      }`}
                                    >
                                      <i className="bi bi-people-fill text-xs"></i>
                                      <span>
                                        {link.conversions || 0} {link.conversions === 1 ? 'comprador' : 'compradores'}
                                      </span>
                                      <i className={`bi bi-chevron-${isProductExpanded ? 'up' : 'down'} text-[10px]`}></i>
                                    </button>
                                  </div>
                                </div>

                                {/* LISTA DESPLEGADA DE QUIÉN LO COMPRÓ (Nivel 3) */}
                                {isProductExpanded && (
                                  <div className="bg-gray-50/90 border-t border-gray-200/80 p-4 sm:p-5 transition-all">
                                    <div className="space-y-3">
                                      <div className="flex items-center justify-between">
                                        <h6 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                                          <i className="bi bi-cart-check text-emerald-600"></i>
                                          Quién compró este producto ({productOrders.length})
                                        </h6>
                                        <span className="text-[11px] font-medium text-gray-500">
                                          Código: <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-gray-200">{link.code}</code>
                                        </span>
                                      </div>

                                      {/* Estado de carga de compradores */}
                                      {isLoadingOrders ? (
                                        <div className="bg-white rounded-xl border border-gray-200/80 p-6 flex items-center justify-center gap-2.5">
                                          <div className="animate-spin h-4 w-4 border-2 border-rose-600 border-t-transparent rounded-full"></div>
                                          <span className="text-xs font-medium text-gray-500">Buscando compradores de este producto...</span>
                                        </div>
                                      ) : productOrders.length > 0 ? (
                                        <div className="space-y-2.5">
                                          {productOrders.map((order) => {
                                            const buyerName = order.customer?.nombres || order.customer?.name || order.customerName || 'Cliente'
                                            const buyerPhone = order.customer?.celular || order.customer?.phone || order.customerPhone || ''
                                            const buyerImage = order.customer?.imagen || order.customer?.photoURL || null
                                            const statusBadge = getOrderStatusBadge(order.status)
                                            const cleanPhone = buyerPhone ? buyerPhone.replace(/[^0-9]/g, '') : ''
                                            const whatsappUrl = cleanPhone ? `https://wa.me/${cleanPhone.startsWith('593') ? cleanPhone : cleanPhone.startsWith('0') ? '593' + cleanPhone.slice(1) : cleanPhone}` : null

                                            return (
                                              <div
                                                key={order.id}
                                                className="bg-white rounded-xl border border-gray-200/90 p-3.5 sm:p-4 hover:border-gray-300 transition-all shadow-xs"
                                              >
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                  {/* Datos del comprador */}
                                                  <div className="flex items-center gap-3 min-w-0">
                                                    <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center flex-shrink-0 shadow-inner">
                                                      {buyerImage ? (
                                                        <img
                                                          src={buyerImage}
                                                          alt={buyerName}
                                                          className="w-full h-full object-cover"
                                                          onError={(e) => {
                                                            (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(buyerName)}&background=random`
                                                          }}
                                                        />
                                                      ) : (
                                                        <i className="bi bi-person-fill text-gray-400 text-lg"></i>
                                                      )}
                                                    </div>

                                                    <div className="min-w-0">
                                                      <div className="flex items-center gap-2 flex-wrap">
                                                        <p className="text-sm font-bold text-gray-900 truncate">
                                                          {buyerName}
                                                        </p>
                                                        {order.orderNumber && (
                                                          <span className="text-[10px] font-mono font-semibold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                                            #{order.orderNumber}
                                                          </span>
                                                        )}
                                                      </div>
                                                      <div className="flex items-center gap-2 text-xs font-medium text-gray-500 mt-0.5">
                                                        <span>{buyerPhone || 'Sin celular'}</span>
                                                        {whatsappUrl && (
                                                          <a
                                                            href={whatsappUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-emerald-600 hover:text-emerald-700 flex items-center gap-1 font-semibold"
                                                            title="Contactar por WhatsApp"
                                                          >
                                                            <i className="bi bi-whatsapp"></i> Chat
                                                          </a>
                                                        )}
                                                      </div>
                                                    </div>
                                                  </div>

                                                  {/* Detalles de la compra */}
                                                  <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 pt-2 sm:pt-0 border-gray-50">
                                                    <div className="text-left sm:text-right">
                                                      <span className="text-sm font-black text-gray-900 tracking-tight block">
                                                        ${Number(order.total || 0).toFixed(2)}
                                                      </span>
                                                      <span className="text-[10px] font-medium text-gray-400 block">
                                                        {formatDate(order.createdAt)}
                                                      </span>
                                                    </div>

                                                    {/* Badge de estado */}
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${statusBadge.bg}`}>
                                                      <i className={`bi ${statusBadge.icon}`}></i>
                                                      {statusBadge.label}
                                                    </span>
                                                  </div>
                                                </div>

                                                {/* Items comprados en la orden (si existen) */}
                                                {order.items && order.items.length > 0 && (
                                                  <div className="mt-3 pt-2.5 border-t border-gray-100 text-xs text-gray-600">
                                                    <span className="font-semibold text-gray-400 text-[10px] uppercase tracking-wider block mb-1">
                                                      Productos en la orden:
                                                    </span>
                                                    <div className="flex flex-wrap gap-1.5">
                                                      {order.items.map((item: any, idx: number) => (
                                                        <span
                                                          key={idx}
                                                          className="inline-flex items-center gap-1 bg-gray-50 border border-gray-200/80 px-2 py-0.5 rounded-md text-[11px] font-medium text-gray-700"
                                                        >
                                                          <span className="font-bold text-gray-900">{item.quantity}x</span>
                                                          <span className="truncate max-w-[180px]">{item.name || item.productName}</span>
                                                          {item.price && (
                                                            <span className="text-gray-400">(${Number(item.price).toFixed(2)})</span>
                                                          )}
                                                        </span>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}
                                              </div>
                                            )
                                          })}
                                        </div>
                                      ) : (
                                        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-6 text-center">
                                          <div className="w-10 h-10 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center mx-auto mb-2">
                                            <i className="bi bi-cart-x text-lg"></i>
                                          </div>
                                          <p className="text-xs font-semibold text-gray-700">Aún no hay compras registradas con este link</p>
                                          <p className="text-[11px] font-medium text-gray-400 mt-0.5">
                                            Cuando un cliente use este enlace ({link.code}) para comprar, aparecerá listado aquí automáticamente.
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
                          <i className="bi bi-link-45deg text-3xl text-gray-300 mb-2 block"></i>
                          <p className="text-xs font-semibold text-gray-700">Este cliente aún no ha generado links de recomendación</p>
                          <p className="text-[11px] font-medium text-gray-400 mt-0.5">
                            Los productos que comparta desde la tienda se reflejarán aquí.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {filteredRecommenders.length === 0 && (
            <div className="p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-3">
                <i className="bi bi-search text-xl"></i>
              </div>
              <h5 className="text-sm font-bold text-gray-900 mb-1">No se encontraron clientes</h5>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                {searchQuery
                  ? `No hay recomendadores que coincidan con "${searchQuery}". Intenta con otro término de búsqueda.`
                  : 'Aún no hay datos de clientes recomendadores registrados.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* MODAL ALTERNATIVO (mantenido por compatibilidad) */}
      {linksModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs" onClick={() => setLinksModal({ open: false, userName: '', userPhone: '' })}></div>
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col z-10 overflow-hidden border border-gray-200">
            {/* Header Modal */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/50">
              <div>
                <h3 className="text-base font-black text-gray-900 tracking-tight leading-tight">
                  Links de {linksModal.userName}
                </h3>
                <p className="text-xs font-medium text-gray-500 leading-relaxed">{linksModal.userPhone}</p>
              </div>
              <button
                onClick={() => setLinksModal({ open: false, userName: '', userPhone: '' })}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <i className="bi bi-x-lg text-sm"></i>
              </button>
            </div>

            {/* Body Modal */}
            <div className="overflow-y-auto flex-1 p-5 space-y-3">
              {modalLoading ? (
                <div className="flex items-center justify-center py-12 gap-3">
                  <div className="animate-spin h-6 w-6 border-2 border-indigo-600 border-t-transparent rounded-full"></div>
                  <span className="text-sm font-medium text-gray-500">Cargando links...</span>
                </div>
              ) : userModalLinks.length > 0 ? (
                userModalLinks.map((link) => (
                  <div key={link.id} className="border border-gray-200 rounded-xl overflow-hidden shadow-xs">
                    <div className="p-4 flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        {link.productImage && (
                          <img
                            src={link.productImage}
                            alt=""
                            className="w-12 h-12 rounded-xl object-cover flex-shrink-0 border border-gray-200"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black text-gray-900 tracking-tight leading-tight truncate">
                            {link.productName || 'Producto'}
                          </p>
                          <p className="text-xs font-medium text-gray-500 leading-relaxed truncate">
                            {link.businessName || ''}
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">{link.code}</code>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-md">
                          {link.clicks || 0} clicks
                        </span>
                        <button
                          type="button"
                          onClick={() => handleToggleModalLinkSales(link.id, link.code)}
                          className="bg-rose-50 text-rose-700 px-2.5 py-1 rounded-lg text-xs font-bold hover:bg-rose-100 transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          {link.conversions || 0} ventas
                          <i className={`bi bi-chevron-${modalExpandedLink === link.id ? 'up' : 'down'} text-[10px]`}></i>
                        </button>
                      </div>
                    </div>

                    {modalExpandedLink === link.id && (
                      <div className="border-t border-gray-100 bg-gray-50 p-4">
                        <h4 className="text-xs font-bold text-gray-700 uppercase mb-3">Ventas generadas</h4>
                        {modalSalesLoading ? (
                          <div className="flex items-center justify-center py-6 gap-2">
                            <div className="animate-spin h-4 w-4 border-2 border-rose-600 border-t-transparent rounded-full"></div>
                            <span className="text-xs font-medium text-gray-500">Cargando ventas...</span>
                          </div>
                        ) : modalLinkSales.length > 0 ? (
                          <div className="space-y-2">
                            {modalLinkSales.map((order) => (
                              <div key={order.id} className="bg-white rounded-lg border border-gray-200 p-3">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-bold text-gray-900">
                                      {order.customer?.nombres || order.customer?.name || 'Cliente'}
                                    </p>
                                    <p className="text-xs text-gray-500">{order.customer?.celular || order.customer?.phone || ''}</p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-sm font-black text-gray-900">${Number(order.total || 0).toFixed(2)}</p>
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                                      {order.status || 'Entregado'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-center text-xs text-gray-500 py-3">No hay ventas registradas para este link.</p>
                        )}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-10">
                  <i className="bi bi-link-45deg text-3xl text-gray-300 mb-2 block"></i>
                  <p className="text-xs text-gray-500">Este usuario no ha creado ningún link aún.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
