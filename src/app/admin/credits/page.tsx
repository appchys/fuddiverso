'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  getAllClientsGlobal,
  getAllUserCreditsGlobal,
  addWalletBalance,
  getWalletTransactions,
  getAllWalletTransactionsGlobal,
  getAllBusinesses
} from '@/lib/database'
import { normalizeEcuadorianPhone } from '@/lib/validation'

interface ClientItem {
  id: string
  nombres?: string
  celular?: string
  email?: string
  createdAt?: any
}

interface CreditDoc {
  id: string
  userId: string
  businessId: string
  balance?: number
  availableCredits?: number
  usedCredits?: number
  totalCredits?: number
  updatedAt?: any
}

interface WalletTx {
  id: string
  userId: string
  businessId?: string
  type: 'balance_credit' | 'balance_debit' | 'order_payment' | 'referral_bonus' | string
  amount: number
  concept: string
  referenceId?: string
  createdBy?: string
  createdAt?: any
}

interface ConsolidatedClient extends ClientItem {
  allIds: string[]
  manualBalance: number
  referralCredits: number
  totalAvailable: number
  totalCredits: number
  usedCredits: number
}

export default function AdminCreditsPage() {
  const [clients, setClients] = useState<ClientItem[]>([])
  const [userCredits, setUserCredits] = useState<CreditDoc[]>([])
  const [globalTxs, setGlobalTxs] = useState<WalletTx[]>([])
  const [businesses, setBusinesses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Ref para hacer focus al monto al seleccionar cliente
  const amountInputRef = useRef<HTMLInputElement>(null)
  const formCardRef = useRef<HTMLDivElement>(null)

  // Búsqueda y Gestión de Cliente
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<ConsolidatedClient | null>(null)
  const [operationType, setOperationType] = useState<'credit' | 'debit'>('credit')
  const [amountInput, setAmountInput] = useState('')
  const [conceptInput, setConceptInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [formHighlighted, setFormHighlighted] = useState(false)

  // Filtros de Tabla
  const [tableSearch, setTableSearch] = useState('')
  const [onlyActiveBalance, setOnlyActiveBalance] = useState(false)

  // Modal de Historial Individual
  const [historyModal, setHistoryModal] = useState<{
    open: boolean
    client: ConsolidatedClient | null
    txs: WalletTx[]
    loading: boolean
  }>({ open: false, client: null, txs: [], loading: false })

  // Pestaña activa (Gestión vs Historial Global)
  const [activeTab, setActiveTab] = useState<'management' | 'history'>('management')

  useEffect(() => {
    document.title = 'Gestión de Saldo - Admin Fuddi'
    loadInitialData()
  }, [])

  const loadInitialData = async () => {
    setLoading(true)
    try {
      const [allClientsData, creditsData, txsData, businessesData] = await Promise.all([
        getAllClientsGlobal(),
        getAllUserCreditsGlobal(),
        getAllWalletTransactionsGlobal(100),
        getAllBusinesses()
      ])

      setClients(allClientsData || [])
      setUserCredits(creditsData || [])
      setGlobalTxs(txsData || [])
      setBusinesses(businessesData || [])
    } catch (err) {
      console.error('Error cargando datos de créditos:', err)
    } finally {
      setLoading(false)
    }
  }

  // CONSOLIDACIÓN Y DEDUPLICACIÓN DE CLIENTES
  // Agrupa múltiples registros del mismo cliente (por teléfono o ID) y unifica su saldo exacto
  const consolidatedClients = useMemo<ConsolidatedClient[]>(() => {
    const phoneMap = new Map<string, { main: ClientItem; allIds: Set<string> }>()

    // 1. Agrupar clientes de la colección 'clients'
    clients.forEach(c => {
      const normPhone = c.celular ? normalizeEcuadorianPhone(c.celular) : ''
      const key = normPhone || c.id || Math.random().toString()

      if (!phoneMap.has(key)) {
        const ids = new Set<string>()
        if (c.id) ids.add(c.id)
        if (normPhone) ids.add(normPhone)
        phoneMap.set(key, { main: { ...c }, allIds: ids })
      } else {
        const existing = phoneMap.get(key)!
        if (c.id) existing.allIds.add(c.id)
        if (normPhone) existing.allIds.add(normPhone)
        if (!existing.main.nombres && c.nombres) existing.main.nombres = c.nombres
        if (!existing.main.email && c.email) existing.main.email = c.email
        if (!existing.main.id && c.id) existing.main.id = c.id
      }
    })

    // 2. Incluir cualquier userId de userCredits que no esté registrado en la tabla de clientes
    userCredits.forEach(uc => {
      if (!uc.userId) return
      const normPhone = normalizeEcuadorianPhone(uc.userId)
      let foundKey: string | null = null
      phoneMap.forEach((item, key) => {
        if (!foundKey && (item.allIds.has(uc.userId) || (normPhone && item.allIds.has(normPhone)))) {
          foundKey = key
        }
      })

      if (!foundKey) {
        const key = normPhone || uc.userId
        const ids = new Set<string>([uc.userId])
        if (normPhone) ids.add(normPhone)
        phoneMap.set(key, {
          main: {
            id: uc.userId,
            nombres: normPhone ? `Cliente ${normPhone}` : `Usuario ${uc.userId.slice(0, 8)}`,
            celular: normPhone || uc.userId
          },
          allIds: ids
        })
      } else {
        phoneMap.get(foundKey)!.allIds.add(uc.userId)
      }
    })

    // 3. Para cada cliente único consolidado, calcular los saldos sin duplicar conteos
    const result: ConsolidatedClient[] = []

    phoneMap.forEach(({ main, allIds }) => {
      const idsArray = Array.from(allIds)
      const matchingCredits = userCredits.filter(uc => uc.userId && idsArray.includes(uc.userId))

      let manualBalance = 0
      let referralCredits = 0
      let totalCredits = 0
      let usedCredits = 0

      matchingCredits.forEach(uc => {
        manualBalance += uc.balance || 0
        referralCredits += uc.availableCredits || 0
        totalCredits += uc.totalCredits || 0
        usedCredits += uc.usedCredits || 0
      })

      result.push({
        ...main,
        allIds: idsArray,
        manualBalance,
        referralCredits,
        totalAvailable: manualBalance + referralCredits,
        totalCredits,
        usedCredits
      })
    })

    // Ordenar por mayor saldo disponible primero, luego por nombre
    return result.sort((a, b) => b.totalAvailable - a.totalAvailable || (a.nombres || '').localeCompare(b.nombres || ''))
  }, [clients, userCredits])

  // Estadísticas globales de saldo sin duplicaciones
  const stats = useMemo(() => {
    let totalBalance = 0
    let totalManualBalance = 0
    let totalReferralCredits = 0
    let totalUsed = 0
    let activeClientsCount = 0

    consolidatedClients.forEach(c => {
      totalBalance += c.totalAvailable
      totalManualBalance += c.manualBalance
      totalReferralCredits += c.referralCredits
      totalUsed += c.usedCredits
      if (c.totalAvailable > 0) {
        activeClientsCount++
      }
    })

    return {
      totalBalance,
      totalManualBalance,
      totalReferralCredits,
      totalUsed,
      activeClientsCount
    }
  }, [consolidatedClients])

  // Sugerencias de clientes al buscar en el panel de gestión
  const clientSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase().trim()
    const normQ = normalizeEcuadorianPhone(q)

    return consolidatedClients.filter(c => {
      const nameMatch = c.nombres?.toLowerCase().includes(q)
      const emailMatch = c.email?.toLowerCase().includes(q)
      const phoneMatch = c.celular && (c.celular.includes(q) || (normQ && normalizeEcuadorianPhone(c.celular).includes(normQ)))
      return nameMatch || emailMatch || phoneMatch
    }).slice(0, 8)
  }, [searchQuery, consolidatedClients])

  // Seleccionar cliente de la lista de sugerencias o tabla
  const handleSelectClient = (client: ConsolidatedClient) => {
    setActiveTab('management')
    setSelectedClient(client)
    setSearchQuery(`${client.nombres || 'Cliente'} (${client.celular || 'Sin celular'})`)
    setFeedback(null)

    // Resaltar visualmente el formulario y desplazarse suavemente hacia él
    setFormHighlighted(true)
    setTimeout(() => setFormHighlighted(false), 2000)

    if (formCardRef.current) {
      formCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    setTimeout(() => {
      if (amountInputRef.current) {
        amountInputRef.current.focus()
      }
    }, 400)
  }

  // Procesar acreditación o débito
  const handleSubmitTransaction = async () => {
    setFeedback(null)
    if (!selectedClient) {
      return setFeedback({ type: 'error', text: 'Por favor selecciona o busca un cliente existente.' })
    }

    const numAmount = parseFloat(amountInput)
    if (isNaN(numAmount) || numAmount <= 0) {
      return setFeedback({ type: 'error', text: 'Ingresa un monto válido mayor a 0.' })
    }

    if (!conceptInput.trim()) {
      return setFeedback({ type: 'error', text: 'Ingresa un concepto o motivo obligatorio.' })
    }

    const normPhone = selectedClient.celular ? normalizeEcuadorianPhone(selectedClient.celular) : ''
    const userId = selectedClient.id || normPhone
    if (!userId) {
      return setFeedback({ type: 'error', text: 'No se pudo determinar el identificador del usuario.' })
    }

    const finalAmount = operationType === 'credit' ? numAmount : -numAmount
    const businessId = businesses[0]?.id || 'global'

    setSubmitting(true)
    try {
      await addWalletBalance(
        userId,
        businessId,
        finalAmount,
        conceptInput.trim(),
        'Admin'
      )

      const successMsg = operationType === 'credit'
        ? `✅ Se acreditaron $${numAmount.toFixed(2)} a ${selectedClient.nombres || normPhone}.`
        : `✅ Se debitaron $${numAmount.toFixed(2)} a ${selectedClient.nombres || normPhone}.`

      setFeedback({ type: 'success', text: successMsg })
      setAmountInput('')
      setConceptInput('')

      // Recargar datos actualizados
      await loadInitialData()
    } catch (err) {
      console.error('Error al procesar saldo:', err)
      setFeedback({ type: 'error', text: 'Ocurrió un error al procesar el saldo. Inténtalo de nuevo.' })
    } finally {
      setSubmitting(false)
    }
  }

  // Abrir historial de transacciones de un cliente consolidado
  const handleOpenClientHistory = async (client: ConsolidatedClient) => {
    setHistoryModal({ open: true, client, txs: [], loading: true })
    try {
      const idsArray = client.allIds || [client.id]
      const allTxPromises = idsArray.map(id => getWalletTransactions(id))
      const results = await Promise.all(allTxPromises)
      const combined = results.flat()

      const uniqueMap = new Map<string, WalletTx>()
      combined.forEach(t => {
        if (t.id) uniqueMap.set(t.id, t)
      })

      // Extraer acreditaciones históricas de la propiedad 'referrals' en userCredits
      const matchingUserCredits = userCredits.filter(uc => uc.userId && idsArray.includes(uc.userId))
      matchingUserCredits.forEach(uc => {
        if (Array.isArray((uc as any).referrals)) {
          (uc as any).referrals.forEach((ref: any, index: number) => {
            const refTxId = `ref-tx-${ref.orderId || index}-${uc.userId}`
            if (!uniqueMap.has(refTxId)) {
              uniqueMap.set(refTxId, {
                id: refTxId,
                userId: uc.userId,
                businessId: uc.businessId,
                type: 'referral_bonus',
                amount: ref.creditAmount || 0.25,
                concept: `Bono por recomendación (Pedido ${ref.orderId ? ref.orderId.slice(0, 8) : 'Referido'})`,
                referenceId: ref.orderId || null,
                createdBy: 'Sistema (Referidos)',
                createdAt: ref.createdAt || ref.completedAt || new Date()
              })
            }
          })
        }
      })

      const sortedTxs = Array.from(uniqueMap.values()).sort((a, b) => {
        const dA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime()
        const dB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime()
        return dB - dA
      })

      setHistoryModal({ open: true, client, txs: sortedTxs, loading: false })
    } catch (err) {
      console.error('Error cargando historial de cliente:', err)
      setHistoryModal({ open: true, client, txs: [], loading: false })
    }
  }

  // Lista de clientes filtrada para la tabla
  const filteredClientsTable = useMemo(() => {
    let result = consolidatedClients

    if (onlyActiveBalance) {
      result = result.filter(c => c.totalAvailable > 0)
    }

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase().trim()
      const normQ = normalizeEcuadorianPhone(q)

      result = result.filter(c => {
        const nameMatch = c.nombres?.toLowerCase().includes(q)
        const emailMatch = c.email?.toLowerCase().includes(q)
        const phoneMatch = c.celular && (c.celular.includes(q) || (normQ && normalizeEcuadorianPhone(c.celular).includes(normQ)))
        return nameMatch || emailMatch || phoneMatch
      })
    }

    return result
  }, [consolidatedClients, tableSearch, onlyActiveBalance])

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 md:p-8 space-y-8">
      {/* HEADER DE LA PÁGINA */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-200/80 pb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <i className="bi bi-wallet2 text-xl"></i>
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight leading-tight">
                Gestión de Saldo y Créditos
              </h1>
              <p className="text-sm text-gray-500 font-medium leading-relaxed">
                Acredita, debita y audita el saldo de la billetera digital de tus clientes.
              </p>
            </div>
          </div>
        </div>

        {/* NAVEGACIÓN SECUNDARIA */}
        <div className="flex items-center gap-2 bg-gray-200/60 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('management')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'management'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <i className="bi bi-sliders me-1.5"></i>
            Gestión y Clientes
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'history'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <i className="bi bi-clock-history me-1.5"></i>
            Historial Global
          </button>
        </div>
      </div>

      {/* ESTADÍSTICAS GLOBALES (CONSOLIDADAS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Saldo Activo Total */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm relative overflow-hidden group hover:border-blue-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Saldo Activo Total</span>
            <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <i className="bi bi-cash-stack"></i>
            </span>
          </div>
          <p className="text-2xl font-black text-gray-900 mt-2 tracking-tight">
            ${stats.totalBalance.toFixed(2)}
          </p>
          <div className="mt-2 text-[11px] text-gray-500 flex items-center gap-2 font-medium">
            <span>Manual: <strong>${stats.totalManualBalance.toFixed(2)}</strong></span>
            <span>•</span>
            <span>Referidos: <strong>${stats.totalReferralCredits.toFixed(2)}</strong></span>
          </div>
        </div>

        {/* Clientes con Saldo */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm relative overflow-hidden group hover:border-blue-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Clientes con Saldo</span>
            <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <i className="bi bi-people-fill"></i>
            </span>
          </div>
          <p className="text-2xl font-black text-gray-900 mt-2 tracking-tight">
            {stats.activeClientsCount}
          </p>
          <p className="mt-2 text-[11px] text-gray-500 font-medium">
            Usuarios únicos con saldo disponible &gt; $0.00
          </p>
        </div>

        {/* Total Consumido */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm relative overflow-hidden group hover:border-blue-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Consumido en Compras</span>
            <span className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <i className="bi bi-bag-check-fill"></i>
            </span>
          </div>
          <p className="text-2xl font-black text-gray-900 mt-2 tracking-tight">
            ${stats.totalUsed.toFixed(2)}
          </p>
          <p className="mt-2 text-[11px] text-gray-500 font-medium">
            Créditos canjeados por pedidos
          </p>
        </div>

        {/* Total Registros Únicos */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm relative overflow-hidden group hover:border-blue-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Clientes Únicos</span>
            <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <i className="bi bi-person-lines-fill"></i>
            </span>
          </div>
          <p className="text-2xl font-black text-gray-900 mt-2 tracking-tight">
            {consolidatedClients.length}
          </p>
          <p className="mt-2 text-[11px] text-gray-500 font-medium">
            Clientes consolidados en el sistema
          </p>
        </div>
      </div>

      {activeTab === 'management' ? (
        <div className="space-y-8">
          {/* PANEL DE GESTIÓN DIRECTA (FORMULARIO) */}
          <div
            ref={formCardRef}
            id="management-form"
            className={`bg-white rounded-2xl border transition-all duration-500 p-6 sm:p-8 ${
              formHighlighted
                ? 'border-blue-500 ring-4 ring-blue-500/20 shadow-xl'
                : 'border-gray-200/80 shadow-sm'
            }`}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                <i className="bi bi-plus-slash-minus text-xl"></i>
              </div>
              <div>
                <h2 className="text-lg font-black text-gray-900 tracking-tight leading-tight">
                  Acreditar o Debitar Saldo
                </h2>
                <p className="text-xs text-gray-500 font-medium">
                  Selecciona un cliente por celular, nombre o email para ajustar su billetera.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* COLUMNA IZQUIERDA: Búsqueda y Datos del Cliente */}
              <div className="lg:col-span-6 space-y-4">
                <div className="relative">
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1">
                    Buscar Cliente
                  </label>
                  <div className="relative">
                    <i className="bi bi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                    <input
                      type="text"
                      placeholder="Escribe celular (ej: 0991234567), nombre o email..."
                      value={searchQuery}
                      onChange={e => {
                        setSearchQuery(e.target.value)
                        if (selectedClient) setSelectedClient(null)
                      }}
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                    />
                  </div>

                  {/* MENÚ DE SUGERENCIAS */}
                  {clientSuggestions.length > 0 && !selectedClient && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-60 overflow-y-auto divide-y divide-gray-100">
                      {clientSuggestions.map((client, idx) => {
                        const itemKey = client.id ? client.id : client.celular ? `cel-${client.celular}` : `sug-${idx}`
                        return (
                          <button
                            key={itemKey}
                            type="button"
                            onClick={() => handleSelectClient(client)}
                            className="w-full px-4 py-3 text-left hover:bg-blue-50/60 transition-colors flex items-center justify-between group"
                          >
                            <div>
                              <p className="text-sm font-bold text-gray-900 group-hover:text-blue-600">
                                {client.nombres || 'Sin Nombre'}
                              </p>
                              <p className="text-xs text-gray-500">
                                {client.celular || 'Sin Celular'} {client.email ? `• ${client.email}` : ''}
                              </p>
                            </div>
                            <div className="text-right">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                                ${client.totalAvailable.toFixed(2)}
                              </span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* TARJETA DEL CLIENTE SELECCIONADO */}
                {selectedClient ? (
                  <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-200/80 space-y-3 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-black text-sm flex items-center justify-center uppercase shadow-sm">
                          {(selectedClient.nombres || 'C').charAt(0)}
                        </div>
                        <div>
                          <h4 className="text-sm font-black text-gray-900 tracking-tight">
                            {selectedClient.nombres || 'Cliente no nombrado'}
                          </h4>
                          <p className="text-xs text-gray-600 font-medium">
                            <i className="bi bi-whatsapp me-1 text-emerald-600"></i>
                            {selectedClient.celular || 'Sin celular registrado'}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleOpenClientHistory(selectedClient)}
                        className="px-3 py-1.5 text-xs font-bold bg-white text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-200 rounded-lg transition-all shadow-sm"
                      >
                        <i className="bi bi-clock-history me-1"></i>
                        Ver Historial
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-blue-200/60 text-center">
                      <div className="bg-white p-2 rounded-lg border border-blue-100">
                        <span className="block text-[10px] font-bold text-gray-400 uppercase">Saldo Manual</span>
                        <span className="text-sm font-black text-gray-800">
                          ${selectedClient.manualBalance.toFixed(2)}
                        </span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-blue-100">
                        <span className="block text-[10px] font-bold text-gray-400 uppercase">Referidos</span>
                        <span className="text-sm font-black text-gray-800">
                          ${selectedClient.referralCredits.toFixed(2)}
                        </span>
                      </div>
                      <div className="bg-emerald-500 text-white p-2 rounded-lg shadow-sm">
                        <span className="block text-[10px] font-bold text-emerald-100 uppercase">Total Disponible</span>
                        <span className="text-sm font-black">
                          ${selectedClient.totalAvailable.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-center text-xs text-gray-500 font-medium">
                    <i className="bi bi-info-circle text-base text-gray-400 block mb-1"></i>
                    Selecciona un cliente arriba o haz clic en <strong>Gestionar</strong> en la tabla de abajo.
                  </div>
                )}
              </div>

              {/* COLUMNA DERECHA: Formulario de Acción */}
              <div className="lg:col-span-6 space-y-4">
                {/* Tipo de Operación */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                    Tipo de Operación
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setOperationType('credit')}
                      className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all border ${
                        operationType === 'credit'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                          : 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100'
                      }`}
                    >
                      <i className="bi bi-plus-circle-fill text-sm"></i>
                      Acreditar (+)
                    </button>
                    <button
                      type="button"
                      onClick={() => setOperationType('debit')}
                      className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all border ${
                        operationType === 'debit'
                          ? 'bg-red-600 text-white border-red-600 shadow-md shadow-red-600/20'
                          : 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100'
                      }`}
                    >
                      <i className="bi bi-dash-circle-fill text-sm"></i>
                      Debitar / Descontar (-)
                    </button>
                  </div>
                </div>

                {/* Monto con Accesos Rápidos */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1">
                    Monto a {operationType === 'credit' ? 'Acreditar' : 'Debitar'} ($)
                  </label>
                  <div className="relative mb-2">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-gray-500 text-sm">$</span>
                    <input
                      ref={amountInputRef}
                      type="number"
                      placeholder="0.00"
                      min="0.01"
                      step="0.01"
                      value={amountInput}
                      onChange={e => setAmountInput(e.target.value)}
                      className="w-full pl-8 pr-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                    />
                  </div>

                  {/* Accesos rápidos de monto */}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-gray-400">Rápidos:</span>
                    {[5, 10, 20, 50].map(val => (
                      <button
                        key={`preset-${val}`}
                        type="button"
                        onClick={() => setAmountInput(val.toString())}
                        className="px-2.5 py-1 text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                      >
                        ${val}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Concepto / Motivo */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1">
                    Concepto / Motivo (Obligatorio)
                  </label>
                  <input
                    type="text"
                    placeholder={operationType === 'credit' ? 'Ej: Devolución por entrega fallida pedido #1042' : 'Ej: Corrección por cobro indebido'}
                    value={conceptInput}
                    onChange={e => setConceptInput(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  />
                </div>

                {/* Feedback Mensaje */}
                {feedback && (
                  <div
                    className={`p-3.5 rounded-xl text-xs font-bold flex items-center gap-2 ${
                      feedback.type === 'success'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-red-50 text-red-800 border border-red-200'
                    }`}
                  >
                    <i className={`bi ${feedback.type === 'success' ? 'bi-check-circle-fill text-emerald-600' : 'bi-exclamation-triangle-fill text-red-600'} text-base`}></i>
                    <span>{feedback.text}</span>
                  </div>
                )}

                {/* Botón Guardar */}
                <button
                  type="button"
                  onClick={handleSubmitTransaction}
                  disabled={submitting || !selectedClient}
                  className={`w-full py-3 px-6 rounded-xl font-bold text-sm text-white shadow-md transition-all flex items-center justify-center gap-2 ${
                    operationType === 'credit'
                      ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                      : 'bg-red-600 hover:bg-red-700 shadow-red-600/20'
                  } disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none`}
                >
                  {submitting ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                      Procesando...
                    </>
                  ) : (
                    <>
                      <i className={`bi ${operationType === 'credit' ? 'bi-plus-circle' : 'bi-dash-circle'}`}></i>
                      {operationType === 'credit' ? 'Confirmar Acreditación de Saldo' : 'Confirmar Débito de Saldo'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* TABLA DE CLIENTES Y CRÉDITOS */}
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
            {/* Header de la Tabla */}
            <div className="p-6 border-b border-gray-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-black text-gray-900 tracking-tight leading-tight">
                  Directorio de Clientes y Saldos
                </h3>
                <p className="text-xs text-gray-500 font-medium">
                  Consulta el saldo disponible por cliente y accede a su bitácora de transacciones.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                {/* Switch Filtro Activo */}
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-700 bg-gray-50 px-3 py-2 rounded-xl border border-gray-200">
                  <input
                    type="checkbox"
                    checked={onlyActiveBalance}
                    onChange={e => setOnlyActiveBalance(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                  />
                  <span>Solo con saldo disponible</span>
                </label>

                {/* Input Búsqueda Tabla */}
                <div className="relative">
                  <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                  <input
                    type="text"
                    placeholder="Filtrar por nombre o cel..."
                    value={tableSearch}
                    onChange={e => setTableSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Cuerpo de la Tabla */}
            {loading ? (
              <div className="p-12 text-center">
                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
                <p className="text-xs text-gray-500 font-medium">Cargando directorio de clientes...</p>
              </div>
            ) : filteredClientsTable.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <i className="bi bi-wallet2 text-3xl text-gray-300 block mb-2"></i>
                <p className="text-sm font-bold text-gray-700">No se encontraron clientes</p>
                <p className="text-xs text-gray-400 mt-1">Prueba ajustando los filtros de búsqueda.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left divide-y divide-gray-200">
                  <thead className="bg-gray-50/80">
                    <tr>
                      <th className="px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Cliente</th>
                      <th className="px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Contacto</th>
                      <th className="px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">Saldo Manual</th>
                      <th className="px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">Referidos</th>
                      <th className="px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">Total Disponible</th>
                      <th className="px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {filteredClientsTable.map((client, idx) => {
                      const isSelected = selectedClient?.celular === client.celular || (selectedClient?.id && selectedClient.id === client.id)
                      const clientKey = client.celular ? `cel-${client.celular}` : client.id ? client.id : `client-${idx}`

                      return (
                        <tr
                          key={clientKey}
                          className={`hover:bg-blue-50/30 transition-colors ${
                            isSelected ? 'bg-blue-50/60' : ''
                          }`}
                        >
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-gray-100 text-gray-700 font-bold text-xs flex items-center justify-center uppercase border border-gray-200">
                                {(client.nombres || 'C').charAt(0)}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-gray-900 leading-tight">
                                  {client.nombres || 'Cliente no registrado'}
                                </p>
                                <span className="text-[11px] text-gray-400 font-medium">
                                  ID: {client.id ? `${client.id.slice(0, 10)}...` : 'Sin ID'}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            <p className="text-xs font-bold text-gray-700">
                              {client.celular || 'Sin celular'}
                            </p>
                            {client.email && (
                              <p className="text-[11px] text-gray-400 truncate max-w-[160px]">
                                {client.email}
                              </p>
                            )}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap text-right text-xs font-medium text-gray-700">
                            ${client.manualBalance.toFixed(2)}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap text-right text-xs font-medium text-gray-700">
                            ${client.referralCredits.toFixed(2)}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black ${
                                client.totalAvailable > 0
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              ${client.totalAvailable.toFixed(2)}
                            </span>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap text-center space-x-2">
                            <button
                              type="button"
                              onClick={() => handleSelectClient(client)}
                              className="px-3 py-1.5 text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow-sm transition-all flex-inline items-center gap-1"
                              title="Seleccionar para cargar o descontar saldo"
                            >
                              <i className="bi bi-pencil-square me-1"></i>
                              Gestionar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenClientHistory(client)}
                              className="px-2.5 py-1.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-800 hover:text-white rounded-lg transition-all"
                              title="Ver bitácora de movimientos"
                            >
                              <i className="bi bi-clock-history me-1"></i>
                              Historial
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* PESTAÑA DE HISTORIAL GLOBAL DE TRANSACCIONES */
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6 sm:p-8 space-y-6">
          <div>
            <h3 className="text-base font-black text-gray-900 tracking-tight leading-tight">
              Últimas Transacciones de Billeteras
            </h3>
            <p className="text-xs text-gray-500 font-medium">
              Bitácora de movimientos globales de saldo (acreditaciones, débitos y consumos por pedidos).
            </p>
          </div>

          {globalTxs.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <i className="bi bi-clock-history text-3xl text-gray-300 block mb-2"></i>
              <p className="text-sm font-bold text-gray-700">No hay transacciones registradas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left divide-y divide-gray-200">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className="px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Fecha / Hora</th>
                    <th className="px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Usuario / Celular</th>
                    <th className="px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Tipo</th>
                    <th className="px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">Monto</th>
                    <th className="px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Concepto</th>
                    <th className="px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Creado por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white text-xs">
                  {globalTxs.map((tx, idx) => {
                    const txDate = tx.createdAt?.toDate ? tx.createdAt.toDate() : new Date(tx.createdAt || Date.now())
                    const isPositive = tx.amount > 0
                    const txKey = tx.id ? tx.id : `gtx-${idx}`

                    const normTxUser = tx.userId ? normalizeEcuadorianPhone(tx.userId) : ''
                    const clientInfo = consolidatedClients.find(c =>
                      c.allIds.includes(tx.userId) ||
                      c.id === tx.userId ||
                      (normTxUser && c.celular && normalizeEcuadorianPhone(c.celular) === normTxUser)
                    )

                    const clientName = clientInfo?.nombres || 'Cliente no registrado'
                    const clientPhone = clientInfo?.celular || (normTxUser || tx.userId || 'Sin celular')

                    return (
                      <tr key={txKey} className="hover:bg-gray-50">
                        <td className="px-6 py-3.5 font-medium text-gray-500">
                          {txDate.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })}{' '}
                          <span className="text-[10px] text-gray-400">{txDate.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}</span>
                        </td>

                        <td className="px-6 py-3.5">
                          <p className="font-bold text-gray-900 leading-tight">
                            {clientName}
                          </p>
                          <span className="text-[11px] text-gray-500 font-medium block mt-0.5">
                            {clientPhone}
                          </span>
                        </td>

                        <td className="px-6 py-3.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            tx.type === 'balance_credit'
                              ? 'bg-emerald-100 text-emerald-800'
                              : tx.type === 'balance_debit'
                              ? 'bg-red-100 text-red-800'
                              : tx.type === 'referral_bonus'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {tx.type === 'balance_credit' ? 'Acreditación' : tx.type === 'balance_debit' ? 'Débito' : tx.type === 'referral_bonus' ? 'Bono Recomendación' : 'Uso en Pedido'}
                          </span>
                        </td>

                        <td className={`px-6 py-3.5 text-right font-black ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                          {isPositive ? `+$${tx.amount.toFixed(2)}` : `-$${Math.abs(tx.amount).toFixed(2)}`}
                        </td>

                        <td className="px-6 py-3.5 text-gray-700 font-medium max-w-xs truncate">
                          {tx.concept}
                        </td>

                        <td className="px-6 py-3.5 text-gray-500 font-medium">
                          {tx.createdBy || 'Sistema'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL DE HISTORIAL DE CLIENTE INDIVIDUAL */}
      {historyModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <div>
                <h3 className="text-base font-black text-gray-900 tracking-tight">
                  Historial de Movimientos: {historyModal.client?.nombres || 'Cliente'}
                </h3>
                <p className="text-xs text-gray-500 font-medium">
                  {historyModal.client?.celular || 'Sin celular'} • Bitácora de transacciones
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryModal({ open: false, client: null, txs: [], loading: false })}
                className="w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 flex items-center justify-center transition-colors"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {historyModal.loading ? (
                <div className="p-8 text-center">
                  <div className="animate-spin h-7 w-7 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-2"></div>
                  <p className="text-xs text-gray-500">Cargando transacciones...</p>
                </div>
              ) : historyModal.txs.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <i className="bi bi-inbox text-3xl text-gray-300 block mb-2"></i>
                  <p className="text-sm font-bold text-gray-700">Este cliente aún no tiene transacciones registradas.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {historyModal.txs.map((tx, idx) => {
                    const txDate = tx.createdAt?.toDate ? tx.createdAt.toDate() : new Date(tx.createdAt || Date.now())
                    const isPositive = tx.amount > 0
                    const modalTxKey = tx.id ? tx.id : `htx-${idx}`

                    return (
                      <div
                        key={modalTxKey}
                        className="p-4 rounded-xl border border-gray-200/80 bg-white flex items-center justify-between hover:border-blue-200 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
                            tx.type === 'referral_bonus'
                              ? 'bg-purple-100 text-purple-600'
                              : isPositive
                              ? 'bg-emerald-100 text-emerald-600'
                              : 'bg-red-100 text-red-600'
                          }`}>
                            <i className={`bi ${tx.type === 'referral_bonus' ? 'bi-gift-fill' : isPositive ? 'bi-arrow-down-left' : 'bi-arrow-up-right'}`}></i>
                          </div>
                          <div>
                            <h5 className="text-xs font-bold text-gray-900 leading-tight">
                              {tx.concept}
                            </h5>
                            <p className="text-[11px] text-gray-400 font-medium">
                              {txDate.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })} • {txDate.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })} • {tx.createdBy || 'Sistema'}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className={`text-sm font-black ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                            {isPositive ? `+$${tx.amount.toFixed(2)}` : `-$${Math.abs(tx.amount).toFixed(2)}`}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => setHistoryModal({ open: false, client: null, txs: [], loading: false })}
                className="px-4 py-2 text-xs font-bold bg-gray-900 text-white hover:bg-gray-800 rounded-xl transition-all shadow-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
