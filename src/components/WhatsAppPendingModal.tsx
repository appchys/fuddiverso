'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { formatWhatsAppMessageText } from '@/lib/whatsapp-format'
import type { CheckoutSession } from '@/components/LiveCheckoutsPanel'

export type WhatsAppConversationStatus = 'pending' | 'confirmed' | 'closed'

export interface ExcludedWhatsAppContact {
  docId: string
  id: string
  phone: string
  displayName?: string
  excludedAtMillis: number
}

export interface PendingWhatsAppConversation {
  docId: string
  id: string
  phone: string
  rawPhone?: string
  displayName?: string
  effectiveName?: string
  fuddiClientName?: string
  fuddiClientId?: string
  fuddiClientEmail?: string
  fuddiClientNotes?: string
  isRegisteredClient?: boolean
  lastMessage?: string
  recentMessages?: string[]
  sentReplies?: Array<{
    id: string
    text: string
    timestampMillis: number
    source?: string
  }>
  chatHistory?: Array<{
    id: string
    waMsgId?: string
    text: string
    timestampMillis: number
    fromMe: boolean
    source?: string
    mediaUrl?: string
    mediaType?: 'image' | 'document' | 'audio' | 'order' | 'contact' | 'location'
    fileName?: string
    reactions?: Array<{
      emoji: string
      fromMe: boolean
    }>
    linkPreview?: {
      url: string
      matchedText?: string
      title?: string
      description?: string
      image?: string | null
      siteName?: string
    } | null
  }>
  canReplyDirectly?: boolean
  pendingReply?: {
    id: string
    text: string
    status: 'pending' | 'failed'
    requestedAtMillis?: number
    failedAtMillis?: number
  } | null
  detectedLocationLink?: string | null
  timestampMillis: number
  unreadCount?: number
  status?: WhatsAppConversationStatus
  confirmedOrderId?: string
  confirmedOrderSource?: 'manual' | 'checkout' | string
  confirmedOrderTotal?: number | null
  confirmedOrderSummary?: string
  confirmedAtMillis?: number | null
  closedAtMillis?: number | null
  resolvedAtMillis?: number | null
  reopenedAtMillis?: number | null
  /** Preorden en curso (íconos completados) persistida hasta confirmar o archivar */
  preorderState?: Partial<import('@/hooks/usePersistedPreorderState').PersistedPreorderState> | null
}

interface WhatsAppPendingModalProps {
  isOpen: boolean
  asPage?: boolean
  businessId?: string
  conversations: PendingWhatsAppConversation[]
  excludedContacts?: ExcludedWhatsAppContact[]
  orders?: any[]
  onClose: () => void
  onSelectConversation: (conversation: PendingWhatsAppConversation) => void
  onOpenChatView?: (
    conversation: PendingWhatsAppConversation,
    initialTab?: any,
    resolvedProfile?: any,
    activeOrder?: any
  ) => void
  renderOrderCard?: (order: any) => React.ReactNode
  onCompleteCheckout?: (session: any) => void
  onCloseConversation?: (docId: string) => void
  onExcludeConversation?: (conversation: PendingWhatsAppConversation) => void
  onUnexcludeContact?: (docId: string) => void
  onReopenConversation?: (docId: string) => void
  onRemoveConversation: (docId: string) => void
  onClearAll: () => void
  onInspectOrder?: (orderId: string, orderObj?: any) => void
}

function formatEcuadorPhoneDisplay(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed || !/^[\d\s+\-().]+$/.test(trimmed)) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  let local = ''
  if (digits.length === 10 && digits.startsWith('09')) {
    local = digits.slice(1)
  } else if (digits.length === 12 && digits.startsWith('5939')) {
    local = digits.slice(3)
  } else if (digits.length === 9 && digits.startsWith('9')) {
    local = digits
  }
  if (local.length === 9) {
    return `+593 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`
  }
  return trimmed
}

function normalizePhoneKey(raw?: string | null): string {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.length >= 9 ? digits.slice(-9) : digits
}

function cleanConversationTitle(conv: PendingWhatsAppConversation): string {
  const candidates = [conv.effectiveName, conv.fuddiClientName, conv.displayName]
  for (const raw of candidates) {
    const trimmed = (raw || '').trim()
    if (!trimmed) continue
    const match = trimmed.match(/^cliente\s*\(([^)]+)\)$/i)
    if (match?.[1]) return formatEcuadorPhoneDisplay(match[1].trim())
    return formatEcuadorPhoneDisplay(trimmed)
  }
  return formatEcuadorPhoneDisplay((conv.phone || conv.rawPhone || '').trim()) || 'WhatsApp'
}

function formatWhatsAppTime(timestampMillis?: number | null): string {
  if (!timestampMillis) return ''
  const d = new Date(timestampMillis)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfToday - startOfTarget) / (24 * 60 * 60 * 1000))
  if (diffDays <= 0) {
    let hours = d.getHours()
    const minutes = String(d.getMinutes()).padStart(2, '0')
    const period = hours >= 12 ? 'pm' : 'am'
    hours = hours % 12 || 12
    return `${hours}:${minutes} ${period}`
  }
  if (diffDays === 1) return 'Ayer'
  if (diffDays < 7) {
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
    return days[d.getDay()]
  }
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}/${mm}/${yy}`
}

function getPreviewMessages(conv: PendingWhatsAppConversation): Array<{ text: string; fromMe: boolean }> {
  const hist = Array.isArray(conv.chatHistory) ? conv.chatHistory : []
  if (hist.length > 0) {
    return hist
      .filter((m) => Boolean(m?.text && m.text.trim()))
      .slice(-3)
      .map((m) => ({ text: m.text.trim(), fromMe: Boolean(m.fromMe) }))
  }
  if (Array.isArray(conv.recentMessages) && conv.recentMessages.length > 0) {
    return conv.recentMessages
      .filter((t) => Boolean(t && t.trim()))
      .slice(-3)
      .map((t) => ({ text: t.trim(), fromMe: false }))
  }
  if (conv.lastMessage && conv.lastMessage.trim()) {
    return [{ text: conv.lastMessage.trim(), fromMe: false }]
  }
  return []
}

function getOrderStatusBadge(status?: string): { label: string; className: string } {
  switch (status) {
    case 'borrador':
      return { label: 'Borrador', className: 'bg-orange-50 text-orange-700 border-orange-200' }
    case 'pending':
      return { label: 'Pendiente', className: 'bg-amber-50 text-amber-700 border-amber-200' }
    case 'confirmed':
      return { label: 'Confirmado', className: 'bg-blue-50 text-blue-700 border-blue-200' }
    case 'preparing':
      return { label: 'Preparando', className: 'bg-purple-50 text-purple-700 border-purple-200' }
    case 'ready':
      return { label: 'Listo', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    case 'on_way':
      return { label: 'En camino', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' }
    case 'delivered':
      return { label: 'Entregado', className: 'bg-slate-100 text-slate-700 border-slate-200' }
    case 'cancelled':
      return { label: 'Cancelado', className: 'bg-red-50 text-red-700 border-red-200' }
    default:
      return { label: 'Confirmado', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  }
}

export default function WhatsAppPendingModal({
  isOpen,
  businessId,
  conversations,
  excludedContacts = [],
  orders = [],
  onClose,
  onSelectConversation,
  onOpenChatView,
  renderOrderCard,
  onCompleteCheckout,
  onExcludeConversation,
  onUnexcludeContact,
  onReopenConversation,
  onRemoveConversation,
  onInspectOrder,
}: WhatsAppPendingModalProps) {
  const [activeSection, setActiveSection] = useState<'archived' | 'excluded'>('archived')
  const [searchQuery, setSearchQuery] = useState('')
  const [openMenuDocId, setOpenMenuDocId] = useState<string | null>(null)
  const [expandedOrderDocIds, setExpandedOrderDocIds] = useState<Record<string, boolean>>({})
  const [historyCheckouts, setHistoryCheckouts] = useState<CheckoutSession[]>([])

  useEffect(() => {
    if (!isOpen || !businessId) {
      setHistoryCheckouts([])
      return
    }
    const q = query(
      collection(db, 'checkoutProgress'),
      where('businessId', '==', businessId),
      orderBy('updatedAt', 'desc'),
      limit(50)
    )
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data({ serverTimestamps: 'estimate' }),
        })) as CheckoutSession[]
        setHistoryCheckouts(
          list.filter(
            (c) =>
              c.currentStep >= 1 &&
              (c.status === 'closed' || c.status === 'abandoned' || c.status === 'completed')
          )
        )
      },
      (err) => {
        console.error('[WhatsAppPendingModal] Error loading checkout history:', err)
      }
    )
    return () => unsub()
  }, [isOpen, businessId])

  const ordersById = useMemo(() => {
    const map = new Map<string, any>()
    for (const o of orders) {
      if (o?.id) map.set(String(o.id), o)
    }
    return map
  }, [orders])

  const ordersByClientOrPhone = useMemo(() => {
    const byClientId = new Map<string, any>()
    const byPhone = new Map<string, any>()
    for (const o of orders) {
      if (!o || o.status === 'cancelled') continue
      const cid = String(o.customer?.id || '').trim()
      if (cid && !byClientId.has(cid)) byClientId.set(cid, o)
      const pKey = normalizePhoneKey(o.customer?.phone)
      if (pKey && !byPhone.has(pKey)) byPhone.set(pKey, o)
    }
    return { byClientId, byPhone }
  }, [orders])

  const findOrderForConv = (conv: PendingWhatsAppConversation) => {
    if (conv.confirmedOrderId && ordersById.has(String(conv.confirmedOrderId))) {
      return ordersById.get(String(conv.confirmedOrderId))
    }
    const cid = String(conv.fuddiClientId || '').trim()
    if (cid && ordersByClientOrPhone.byClientId.has(cid)) {
      return ordersByClientOrPhone.byClientId.get(cid)
    }
    const pKey = normalizePhoneKey(conv.phone || conv.rawPhone)
    if (pKey && ordersByClientOrPhone.byPhone.has(pKey)) {
      return ordersByClientOrPhone.byPhone.get(pKey)
    }
    return null
  }

  const findOrderForCheckout = (session: CheckoutSession) => {
    const cid = String(session.clientId || '').trim()
    if (cid && ordersByClientOrPhone.byClientId.has(cid)) {
      return ordersByClientOrPhone.byClientId.get(cid)
    }
    const pKey = normalizePhoneKey(session.customerData?.phone)
    if (pKey && ordersByClientOrPhone.byPhone.has(pKey)) {
      return ordersByClientOrPhone.byPhone.get(pKey)
    }
    return null
  }

  const getCheckoutActivityMillis = (session: CheckoutSession): number => {
    if (typeof session.closedAtMillis === 'number' && session.closedAtMillis > 0) {
      return session.closedAtMillis
    }
    if (typeof session.updatedAtMillis === 'number' && session.updatedAtMillis > 0) {
      return session.updatedAtMillis
    }
    const raw = session.updatedAt || session.lastActivityAt
    if (raw && typeof raw.toDate === 'function') {
      return raw.toDate().getTime()
    }
    return 0
  }

  const unifiedHistoryItems = useMemo(() => {
    type HistoryItem =
      | { kind: 'whatsapp'; key: string; sortAt: number; conv: PendingWhatsAppConversation }
      | { kind: 'checkout'; key: string; sortAt: number; session: CheckoutSession }

    const q = searchQuery.trim().toLowerCase()
    const items: HistoryItem[] = []

    for (const c of conversations) {
      if (c.status !== 'closed' && c.status !== 'confirmed') continue
      if (q) {
        const title = cleanConversationTitle(c).toLowerCase()
        const phone = String(c.phone || c.rawPhone || '').toLowerCase()
        const preview = getPreviewMessages(c)
          .map((m) => m.text.toLowerCase())
          .join(' ')
        if (!title.includes(q) && !phone.includes(q) && !preview.includes(q)) continue
      }
      items.push({
        kind: 'whatsapp',
        key: `wa:${c.docId || c.id}`,
        sortAt: c.closedAtMillis || c.resolvedAtMillis || c.timestampMillis || 0,
        conv: c,
      })
    }

    for (const session of historyCheckouts) {
      if (q) {
        const name = String(session.customerData?.name || '').toLowerCase()
        const phone = String(session.customerData?.phone || '').toLowerCase()
        const prodNames = Array.isArray(session.cartItems)
          ? session.cartItems.map((i: any) => String(i.name || i.productName || '').toLowerCase()).join(' ')
          : ''
        if (!name.includes(q) && !phone.includes(q) && !prodNames.includes(q)) continue
      }
      items.push({
        kind: 'checkout',
        key: `co:${session.id}`,
        sortAt: getCheckoutActivityMillis(session),
        session,
      })
    }

    items.sort((a, b) => b.sortAt - a.sortAt)
    return items
  }, [conversations, historyCheckouts, searchQuery])

  const filteredExcluded = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return excludedContacts
      .filter((c) => {
        if (!q) return true
        return (
          String(c.displayName || '').toLowerCase().includes(q) ||
          String(c.phone || '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => (b.excludedAtMillis || 0) - (a.excludedAtMillis || 0))
  }, [excludedContacts, searchQuery])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 h-[100dvh] w-full flex flex-col bg-slate-50 overflow-hidden animate-in fade-in slide-in-from-right-3 duration-150"
      onClick={() => {
        if (openMenuDocId) setOpenMenuDocId(null)
      }}
    >
      {/* Top Header */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-6 py-2.5 shrink-0">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              style={{ minHeight: 0 }}
              onClick={onClose}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
              title="Volver"
            >
              <i className="bi bi-arrow-left text-base"></i>
            </button>
            <i className="bi bi-clock-history text-slate-700 text-base shrink-0"></i>
            <h2 className="text-sm sm:text-base font-black text-gray-900 tracking-tight truncate">
              Historial de mensajes
            </h2>
            {unifiedHistoryItems.length > 0 && (
              <span className="shrink-0 bg-slate-200 text-slate-700 text-xs font-black px-2 py-0.5 rounded-full">
                {unifiedHistoryItems.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl shrink-0">
            <button
              type="button"
              style={{ minHeight: 0 }}
              onClick={() => setActiveSection('archived')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                activeSection === 'archived'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Archivados
            </button>
            <button
              type="button"
              style={{ minHeight: 0 }}
              onClick={() => setActiveSection('excluded')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                activeSection === 'excluded'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Excluidos</span>
              {excludedContacts.length > 0 && (
                <span className="bg-red-100 text-red-700 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                  {excludedContacts.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white/80 border-b border-slate-200/70 px-3 sm:px-6 py-2 shrink-0">
        <div className="max-w-3xl mx-auto relative">
          <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              activeSection === 'archived'
                ? 'Buscar por cliente, teléfono o mensaje...'
                : 'Buscar número excluido...'
            }
            className="w-full h-9 pl-8 pr-8 bg-slate-100/80 hover:bg-slate-100 focus:bg-white border border-transparent focus:border-slate-300 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              style={{ minHeight: 0, minWidth: 0 }}
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              title="Limpiar búsqueda"
            >
              <i className="bi bi-x-circle-fill text-xs"></i>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full p-3 sm:p-5 space-y-3 pb-24">
          {activeSection === 'archived' ? (
            unifiedHistoryItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mb-3">
                  <i className="bi bi-archive text-xl"></i>
                </div>
                <p className="text-sm font-black text-gray-900 tracking-tight mb-1">
                  {searchQuery ? 'Sin resultados' : 'No hay conversaciones archivadas'}
                </p>
                <p className="text-xs font-medium text-gray-500 max-w-xs leading-relaxed">
                  {searchQuery
                    ? 'Intenta con otro nombre, número o palabra clave.'
                    : 'Cuando archives un chat, entregues un pedido o cierre un checkout, aparecerá aquí.'}
                </p>
              </div>
            ) : (
              unifiedHistoryItems.map((item) => {
                if (item.kind === 'checkout') {
                  const session = item.session
                  const docKey = item.key
                  const displayName =
                    (session.customerData?.name || '').trim() ||
                    formatEcuadorPhoneDisplay(session.customerData?.phone || '') ||
                    'Cliente en checkout'
                  const cartItems = Array.isArray(session.cartItems)
                    ? session.cartItems
                    : []
                  const total = cartItems.reduce(
                    (sum: number, it: any) => sum + Number(it.price || 0) * Number(it.quantity || 1),
                    0
                  )
                  const timeLabel = formatWhatsAppTime(item.sortAt)
                  const activeOrder = findOrderForCheckout(session)
                  const isOrderExpanded = Boolean(expandedOrderDocIds[docKey])

                  return (
                    <div
                      key={docKey}
                      className="bg-white rounded-xl shadow-xs border border-gray-200/90 transition-all hover:border-blue-300"
                    >
                      <div className="p-3 sm:p-3.5 bg-white rounded-xl space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <i className="bi bi-cart-check-fill text-blue-600 text-sm shrink-0"></i>
                            <span className="font-bold text-sm text-gray-900 truncate">
                              {displayName}
                            </span>
                            {session.status === 'completed' ? (
                              <span className="shrink-0 inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Completado
                              </span>
                            ) : session.status === 'abandoned' ? (
                              <span className="shrink-0 inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                Abandonado
                              </span>
                            ) : (
                              <span className="shrink-0 inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                                Checkout
                              </span>
                            )}
                          </div>
                          {timeLabel && (
                            <span className="text-[11px] font-medium text-gray-400 shrink-0">
                              {timeLabel}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2.5">
                          <div className="flex-1 min-w-0 space-y-0.5">
                            {cartItems.length > 0 ? (
                              <p className="text-xs text-gray-600 line-clamp-2 leading-snug">
                                {cartItems
                                  .map((it: any) => `${it.quantity || 1}× ${it.name || it.productName || 'Producto'}`)
                                  .join(', ')}
                                {total > 0 ? ` · $${total.toFixed(2)}` : ''}
                              </p>
                            ) : (
                              <p className="text-xs text-gray-400 italic">
                                Paso {session.currentStep} del checkout
                              </p>
                            )}
                          </div>

                          <div className="shrink-0 flex items-center gap-1.5">
                            {activeOrder ? (
                              <button
                                type="button"
                                style={{ minHeight: 0, minWidth: 0 }}
                                onClick={() => {
                                  if (renderOrderCard) {
                                    setExpandedOrderDocIds((prev) => ({
                                      ...prev,
                                      [docKey]: !prev[docKey],
                                    }))
                                  } else {
                                    onInspectOrder?.(activeOrder.id, activeOrder)
                                  }
                                }}
                                title={isOrderExpanded ? 'Ocultar pedido' : 'Ver pedido asociado'}
                                className="w-9 h-9 min-h-0 min-w-0 p-0 inline-flex items-center justify-center rounded-full shrink-0 cursor-pointer active:scale-95 transition-transform"
                              >
                                <span
                                  className={`w-8 h-8 rounded-full inline-flex items-center justify-center text-white shadow-xs transition-colors ${
                                    isOrderExpanded
                                      ? 'bg-blue-700 ring-2 ring-blue-300'
                                      : 'bg-blue-600 hover:bg-blue-700'
                                  }`}
                                >
                                  <i className="bi bi-bag-check-fill text-xs"></i>
                                </span>
                              </button>
                            ) : onCompleteCheckout ? (
                              <button
                                type="button"
                                style={{ minHeight: 0 }}
                                onClick={() => onCompleteCheckout(session)}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold transition-colors cursor-pointer"
                                title="Completar pedido manualmente"
                              >
                                Crear pedido
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {activeOrder && isOrderExpanded && renderOrderCard && (
                        <div
                          className="px-2.5 pb-2.5 pt-1 bg-slate-50/80 border-t border-blue-100 rounded-b-xl"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {renderOrderCard(activeOrder)}
                        </div>
                      )}
                    </div>
                  )
                }

                const conv = item.conv
                const docKey = conv.docId || conv.id
                const displayName = cleanConversationTitle(conv)
                const previewMessages = getPreviewMessages(conv)
                const activeOrder = findOrderForConv(conv)
                const isOrderExpanded = Boolean(expandedOrderDocIds[docKey])
                const timeLabel = formatWhatsAppTime(
                  conv.closedAtMillis || conv.resolvedAtMillis || conv.timestampMillis
                )
                const isMenuOpen = openMenuDocId === docKey

                return (
                  <div
                    key={docKey}
                    className="bg-white rounded-xl shadow-xs border border-gray-200/90 transition-all hover:border-slate-300"
                  >
                    <div
                      className="p-3 sm:p-3.5 bg-white rounded-xl cursor-pointer hover:bg-slate-50/70 transition-colors space-y-2"
                      onClick={() => {
                        if (onOpenChatView) {
                          onOpenChatView(conv, undefined, undefined, activeOrder)
                        } else {
                          onSelectConversation(conv)
                        }
                      }}
                    >
                      {/* Top row: Name + status badge + time */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <i className="bi bi-whatsapp text-green-600 text-sm shrink-0"></i>
                          <span className="font-bold text-sm text-gray-900 truncate">
                            {displayName}
                          </span>
                          {activeOrder ? (() => {
                            const badge = getOrderStatusBadge(activeOrder.status)
                            return (
                              <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${badge.className}`}>
                                {badge.label}
                              </span>
                            )
                          })() : conv.status === 'confirmed' || conv.confirmedOrderId ? (
                            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Confirmado
                            </span>
                          ) : (
                            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                              Archivado
                            </span>
                          )}
                        </div>
                        {timeLabel && (
                          <span className="text-[11px] font-medium text-gray-400 shrink-0">
                            {timeLabel}
                          </span>
                        )}
                      </div>

                      {/* Second row: Last messages + action buttons */}
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="flex-1 min-w-0 space-y-0.5">
                          {previewMessages.length > 0 ? (
                            previewMessages.map((msg, idx) => (
                              <p
                                key={idx}
                                className={`text-[11px] leading-snug line-clamp-1 ${
                                  msg.fromMe ? 'text-gray-400' : 'text-gray-600'
                                }`}
                              >
                                {msg.fromMe && (
                                  <span className="font-bold text-gray-500 mr-1">Tú:</span>
                                )}
                                {formatWhatsAppMessageText(msg.text)}
                              </p>
                            ))
                          ) : (
                            <p className="text-[11px] text-gray-400 italic">Sin mensajes recientes</p>
                          )}
                        </div>

                        <div className="shrink-0 flex items-center gap-1.5">
                          {onReopenConversation && (
                            <button
                              type="button"
                              style={{ minHeight: 0, minWidth: 0 }}
                              onClick={(e) => {
                                e.stopPropagation()
                                onReopenConversation(conv.docId)
                              }}
                              className="w-8 h-8 min-h-0 min-w-0 p-0 inline-flex items-center justify-center bg-gray-50 hover:bg-emerald-50 text-gray-500 hover:text-emerald-700 border border-gray-200/90 hover:border-emerald-200 rounded-full transition-all shrink-0 cursor-pointer"
                              title="Mover a Clientes comprando ahora"
                              aria-label="Reabrir conversación"
                            >
                              <i className="bi bi-arrow-counterclockwise text-xs"></i>
                            </button>
                          )}

                          {activeOrder && (
                            <button
                              type="button"
                              style={{ minHeight: 0, minWidth: 0 }}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (renderOrderCard) {
                                  setExpandedOrderDocIds((prev) => ({
                                    ...prev,
                                    [docKey]: !prev[docKey],
                                  }))
                                } else {
                                  onInspectOrder?.(activeOrder.id, activeOrder)
                                }
                              }}
                              title={isOrderExpanded ? 'Ocultar pedido' : 'Ver pedido asociado'}
                              aria-label={isOrderExpanded ? 'Ocultar pedido' : 'Ver pedido asociado'}
                              className="w-9 h-9 min-h-0 min-w-0 p-0 inline-flex items-center justify-center rounded-full shrink-0 cursor-pointer active:scale-95 transition-transform"
                            >
                              <span
                                className={`w-8 h-8 rounded-full inline-flex items-center justify-center text-white shadow-xs transition-colors ${
                                  isOrderExpanded
                                    ? 'bg-blue-700 ring-2 ring-blue-300'
                                    : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                              >
                                <i className="bi bi-bag-check-fill text-xs"></i>
                              </span>
                            </button>
                          )}

                          <div className="relative">
                            <button
                              type="button"
                              style={{ minHeight: 0, minWidth: 0 }}
                              onClick={(e) => {
                                e.stopPropagation()
                                setOpenMenuDocId(isMenuOpen ? null : docKey)
                              }}
                              className="w-8 h-8 min-h-0 min-w-0 p-0 inline-flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                              title="Más opciones"
                              aria-label="Más opciones"
                            >
                              <i className="bi bi-three-dots-vertical text-xs"></i>
                            </button>

                            {isMenuOpen && (
                              <div
                                className="absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-30"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {onExcludeConversation && (
                                  <button
                                    type="button"
                                    style={{ minHeight: 0 }}
                                    onClick={() => {
                                      setOpenMenuDocId(null)
                                      onExcludeConversation(conv)
                                    }}
                                    className="w-full px-3 py-2 text-left hover:bg-red-50 flex items-center gap-2 text-xs font-bold text-red-600 transition-colors"
                                  >
                                    <i className="bi bi-slash-circle text-xs"></i>
                                    <span>Excluir número</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  style={{ minHeight: 0 }}
                                  onClick={() => {
                                    setOpenMenuDocId(null)
                                    onRemoveConversation(conv.docId)
                                  }}
                                  className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-xs font-semibold text-slate-700 transition-colors"
                                >
                                  <i className="bi bi-trash3 text-slate-500 text-xs"></i>
                                  <span>Eliminar del historial</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {activeOrder && isOrderExpanded && renderOrderCard && (
                      <div
                        className="px-2.5 pb-2.5 pt-1 bg-slate-50/80 border-t border-blue-100 rounded-b-xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {renderOrderCard(activeOrder)}
                      </div>
                    )}
                  </div>
                )
              })
            )
          ) : filteredExcluded.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
              <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-3">
                <i className="bi bi-slash-circle text-xl"></i>
              </div>
              <p className="text-sm font-black text-gray-900 tracking-tight mb-1">
                {searchQuery ? 'Sin resultados' : 'No hay números excluidos'}
              </p>
              <p className="text-xs font-medium text-gray-500 max-w-xs leading-relaxed">
                Los números que excluyas desde un chat dejarán de notificar en Clientes comprando ahora.
              </p>
            </div>
          ) : (
            filteredExcluded.map((contact) => (
              <div
                key={contact.docId || contact.id}
                className="bg-white rounded-xl shadow-xs border border-gray-200/90 p-3 sm:p-3.5 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                    <i className="bi bi-slash-circle text-sm"></i>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">
                      {contact.displayName || formatEcuadorPhoneDisplay(contact.phone)}
                    </p>
                    <p className="text-xs font-medium text-gray-500 truncate">
                      {formatEcuadorPhoneDisplay(contact.phone)}
                    </p>
                  </div>
                </div>
                {onUnexcludeContact && (
                  <button
                    type="button"
                    style={{ minHeight: 0 }}
                    onClick={() => onUnexcludeContact(contact.docId)}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 text-xs font-bold transition-colors cursor-pointer"
                  >
                    Reactivar
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
