'use client'

import React, { useMemo, useState } from 'react'

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
}

interface WhatsAppPendingModalProps {
  isOpen: boolean
  conversations: PendingWhatsAppConversation[]
  excludedContacts?: ExcludedWhatsAppContact[]
  orders?: any[]
  onClose: () => void
  onSelectConversation: (conversation: PendingWhatsAppConversation) => void
  onCloseConversation?: (docId: string) => void
  onExcludeConversation?: (conversation: PendingWhatsAppConversation) => void
  onUnexcludeContact?: (docId: string) => void
  onReopenConversation?: (docId: string) => void
  onRemoveConversation: (docId: string) => void
  onClearAll: () => void
  onInspectOrder?: (orderId: string, orderObj?: any) => void
}

function formatRelativeTime(timestampMillis?: number | null): string {
  if (!timestampMillis) return ''
  const diff = Date.now() - timestampMillis
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Ahora'
  if (minutes < 60) return `Hace ${minutes}m`
  if (minutes < 24 * 60) {
    return new Date(timestampMillis).toLocaleTimeString('es-EC', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  return new Date(timestampMillis).toLocaleDateString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getOrderStatusMeta(status?: string): { label: string; className: string } {
  switch (status) {
    case 'pending':
      return { label: 'Pendiente', className: 'bg-amber-100 text-amber-800 border-amber-200' }
    case 'confirmed':
      return { label: 'Confirmado', className: 'bg-blue-100 text-blue-800 border-blue-200' }
    case 'preparing':
      return { label: 'Preparando', className: 'bg-indigo-100 text-indigo-800 border-indigo-200' }
    case 'ready':
      return { label: 'Listo', className: 'bg-purple-100 text-purple-800 border-purple-200' }
    case 'on_way':
      return { label: 'En camino', className: 'bg-sky-100 text-sky-800 border-sky-200' }
    case 'delivered':
      return { label: 'Entregado', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' }
    case 'cancelled':
      return { label: 'Cancelado', className: 'bg-red-100 text-red-800 border-red-200' }
    case 'borrador':
      return { label: 'Borrador', className: 'bg-slate-200 text-slate-700 border-slate-300' }
    default:
      return { label: 'Confirmado', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' }
  }
}

export default function WhatsAppPendingModal({
  isOpen,
  conversations,
  excludedContacts = [],
  orders = [],
  onClose,
  onSelectConversation,
  onCloseConversation,
  onExcludeConversation,
  onUnexcludeContact,
  onReopenConversation,
  onRemoveConversation,
  onClearAll,
  onInspectOrder
}: WhatsAppPendingModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [resolvedExpanded, setResolvedExpanded] = useState(false)
  const [resolvedFilter, setResolvedFilter] = useState<'all' | 'confirmed' | 'closed'>('all')
  const [expandedTraceDocId, setExpandedTraceDocId] = useState<string | null>(null)
  const [openMenuDocId, setOpenMenuDocId] = useState<string | null>(null)
  const [showExcludedModal, setShowExcludedModal] = useState(false)

  const ordersById = useMemo(() => {
    const map = new Map<string, any>()
    for (const o of orders) {
      if (o?.id) map.set(String(o.id), o)
    }
    return map
  }, [orders])

  const { pendingList, confirmedList, closedList, resolvedList } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const matchesSearch = (conv: PendingWhatsAppConversation) => {
      if (!q) return true
      const name = (conv.effectiveName || conv.fuddiClientName || conv.displayName || '').toLowerCase()
      const phone = (conv.phone || '').toLowerCase()
      const msg = (conv.lastMessage || '').toLowerCase()
      const orderId = (conv.confirmedOrderId || '').toLowerCase()
      return name.includes(q) || phone.includes(q) || msg.includes(q) || orderId.includes(q)
    }

    const pending: PendingWhatsAppConversation[] = []
    const confirmed: PendingWhatsAppConversation[] = []
    const closed: PendingWhatsAppConversation[] = []

    for (const conv of conversations) {
      if (!matchesSearch(conv)) continue
      const st = conv.status || 'pending'
      if (st === 'confirmed') {
        confirmed.push(conv)
      } else if (st === 'closed') {
        closed.push(conv)
      } else {
        pending.push(conv)
      }
    }

    const sortResolved = (a: PendingWhatsAppConversation, b: PendingWhatsAppConversation) => {
      const ta = a.resolvedAtMillis || a.confirmedAtMillis || a.closedAtMillis || a.timestampMillis || 0
      const tb = b.resolvedAtMillis || b.confirmedAtMillis || b.closedAtMillis || b.timestampMillis || 0
      return tb - ta
    }

    confirmed.sort(sortResolved)
    closed.sort(sortResolved)
    const resolved = [...confirmed, ...closed].sort(sortResolved)

    return {
      pendingList: pending,
      confirmedList: confirmed,
      closedList: closed,
      resolvedList: resolved
    }
  }, [conversations, searchQuery])

  const filteredResolvedList = useMemo(() => {
    if (resolvedFilter === 'confirmed') return confirmedList
    if (resolvedFilter === 'closed') return closedList
    return resolvedList
  }, [resolvedFilter, confirmedList, closedList, resolvedList])

  if (!isOpen) return null

  const handleCloseWithoutOrder = (docId: string) => {
    if (onCloseConversation) {
      onCloseConversation(docId)
    } else {
      onRemoveConversation(docId)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[88vh] flex flex-col rounded-2xl bg-slate-50 shadow-2xl overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-white px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <i className="bi bi-whatsapp text-green-700 text-xl"></i>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-base sm:text-lg font-extrabold text-slate-900 truncate">
                WhatsApp Business
              </h3>
              {pendingList.length > 0 && (
                <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-green-600 text-white">
                  {pendingList.length}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {pendingList.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                title="Cerrar todas las conversaciones pendientes sin pedido"
              >
                <i className="bi bi-check2-all"></i>
                <span>Cerrar pendientes</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowExcludedModal(true)}
              className="relative p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
              title="Configuración y números excluidos"
              aria-label="Configuración y números excluidos"
            >
              <i className="bi bi-gear text-sm"></i>
              {excludedContacts.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-1 rounded-full bg-slate-700 text-white text-[9px] font-bold flex items-center justify-center">
                  {excludedContacts.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
              aria-label="Cerrar"
            >
              <i className="bi bi-x-lg text-sm"></i>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
          {conversations.length > 2 && (
            <div className="relative">
              <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nombre, celular, mensaje o #orden..."
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <i className="bi bi-x-circle-fill text-sm"></i>
                </button>
              )}
            </div>
          )}

          {/* Pending Conversations List */}
          {pendingList.length > 0 &&
            pendingList.map((conv) => {
              const displayName =
                conv.effectiveName ||
                conv.fuddiClientName ||
                conv.displayName ||
                (conv.phone ? `Cliente (${conv.phone})` : 'Cliente de WhatsApp Business')
              const isRegistered = Boolean(conv.isRegisteredClient)
              const previewMessages =
                conv.recentMessages && conv.recentMessages.length > 0
                  ? conv.recentMessages.slice(-3)
                  : conv.lastMessage
                    ? [conv.lastMessage]
                    : []

              return (
                <div
                  key={conv.docId || conv.id}
                  onClick={() => onSelectConversation(conv)}
                  className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs hover:border-green-300 hover:shadow-sm transition-all cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                          isRegistered ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        <i className={`bi ${isRegistered ? 'bi-person-fill' : 'bi-person-plus-fill'} text-lg`}></i>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-extrabold text-sm text-slate-900 truncate max-w-[200px]">
                            {displayName}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isRegistered
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {isRegistered ? 'En Fuddi' : 'Nuevo'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-bold ${
                              conv.phone ? 'text-emerald-600' : 'text-slate-500'
                            }`}
                          >
                            <i className="bi bi-telephone text-[11px]"></i>
                            {conv.phone || 'Buscar por nombre'}
                          </span>
                          <span className="text-slate-300 text-xs">•</span>
                          <span className="text-[11px] text-slate-500">
                            {formatRelativeTime(conv.timestampMillis)}
                          </span>
                          {(conv.unreadCount || 0) > 1 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-green-600 text-white text-[10px] font-bold">
                              {conv.unreadCount} msj
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenMenuDocId(openMenuDocId === conv.docId ? null : conv.docId)
                        }
                        className="p-1 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100"
                        title="Más opciones"
                        aria-label="Más opciones"
                      >
                        <i className="bi bi-three-dots-vertical text-sm"></i>
                      </button>
                      {openMenuDocId === conv.docId && (
                        <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-30">
                          {onExcludeConversation && (
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuDocId(null)
                                onExcludeConversation(conv)
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-red-50 flex items-start gap-2 transition-colors"
                            >
                              <i className="bi bi-slash-circle text-red-600 text-xs mt-0.5"></i>
                              <div>
                                <p className="text-xs font-bold text-red-600">Excluir</p>
                                <p className="text-[10px] text-slate-500">
                                  No notificar de este número
                                </p>
                              </div>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuDocId(null)
                              handleCloseWithoutOrder(conv.docId)
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-xs font-semibold text-slate-700 transition-colors"
                          >
                            <i className="bi bi-check2-circle text-slate-500"></i>
                            <span>Cerrar sin pedido</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {previewMessages.length > 0 && (
                    <div className="mt-2 rounded-lg bg-slate-100 px-2.5 py-2 space-y-1">
                      {previewMessages.map((msg, idx) => (
                        <p key={idx} className="text-xs text-slate-700 line-clamp-2 leading-snug">
                          💬 {msg}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      {conv.detectedLocationLink && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-100 text-sky-800 text-[11px] font-bold">
                          <i className="bi bi-geo-alt-fill text-sky-600"></i>
                          Ubicación incluida
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 ml-auto">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleCloseWithoutOrder(conv.docId)
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
                        title="Marcar para cerrar esta conversación sin pedido"
                      >
                        <i className="bi bi-check2-circle"></i>
                        <span>Cerrar sin pedido</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectConversation(conv)
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors"
                      >
                        <i className="bi bi-cart-plus-fill"></i>
                        <span>Crear pedido</span>
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

          {/* Collapsible Section at the End: Confirmed & Closed Conversations */}
          {resolvedList.length > 0 && (
            <div className="pt-2">
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
                <button
                  type="button"
                  onClick={() => setResolvedExpanded((prev) => !prev)}
                  className="w-full px-3.5 py-3 flex items-center justify-between gap-2 bg-slate-50/80 hover:bg-slate-100/80 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <i className="bi bi-archive text-slate-600 text-sm"></i>
                    <span className="text-xs font-extrabold text-slate-800">
                      Conversaciones gestionadas ({resolvedList.length})
                    </span>
                    {confirmedList.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        <i className="bi bi-check-circle-fill text-emerald-600"></i>
                        {confirmedList.length} confirmada{confirmedList.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {closedList.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                        {closedList.length} cerrada{closedList.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <i
                    className={`bi bi-chevron-${resolvedExpanded ? 'up' : 'down'} text-slate-500 text-xs shrink-0`}
                  ></i>
                </button>

                {resolvedExpanded && (
                  <div className="p-3 space-y-2.5 border-t border-slate-200 bg-slate-50/40">
                    {confirmedList.length > 0 && closedList.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setResolvedFilter('all')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                            resolvedFilter === 'all'
                              ? 'bg-slate-800 text-white'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          Todas ({resolvedList.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setResolvedFilter('confirmed')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                            resolvedFilter === 'confirmed'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          Confirmadas ({confirmedList.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setResolvedFilter('closed')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                            resolvedFilter === 'closed'
                              ? 'bg-slate-600 text-white'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          Cerradas sin pedido ({closedList.length})
                        </button>
                      </div>
                    )}

                    {filteredResolvedList.map((conv) => {
                      const isConfirmed = conv.status === 'confirmed'
                      const displayName =
                        conv.effectiveName ||
                        conv.fuddiClientName ||
                        conv.displayName ||
                        (conv.phone ? `Cliente (${conv.phone})` : 'Cliente de WhatsApp Business')
                      const linkedOrder = conv.confirmedOrderId
                        ? ordersById.get(String(conv.confirmedOrderId))
                        : undefined
                      const orderStatusMeta = getOrderStatusMeta(linkedOrder?.status)
                      const isTraceOpen = expandedTraceDocId === conv.docId
                      const orderTotal =
                        typeof linkedOrder?.total === 'number'
                          ? linkedOrder.total
                          : typeof conv.confirmedOrderTotal === 'number'
                            ? conv.confirmedOrderTotal
                            : null
                      const orderSummary =
                        (Array.isArray(linkedOrder?.items) && linkedOrder.items.length > 0
                          ? linkedOrder.items
                              .map((it: any) => `${it.quantity || 1}x ${it.productName || it.name || 'Producto'}`)
                              .join(', ')
                          : conv.confirmedOrderSummary) || ''
                      const previewMessages =
                        conv.recentMessages && conv.recentMessages.length > 0
                          ? conv.recentMessages.slice(-2)
                          : conv.lastMessage
                            ? [conv.lastMessage]
                            : []

                      return (
                        <div
                          key={conv.docId || conv.id}
                          onClick={() => {
                            if (isConfirmed && conv.confirmedOrderId) {
                              setExpandedTraceDocId(isTraceOpen ? null : conv.docId)
                            }
                          }}
                          className={`rounded-xl border p-3 bg-white transition-all ${
                            isConfirmed ? 'border-emerald-200 cursor-pointer hover:border-emerald-300' : 'border-slate-200 opacity-90'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div
                                className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                                  isConfirmed
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-slate-200 text-slate-600'
                                }`}
                              >
                                <i
                                  className={`bi ${
                                    isConfirmed ? 'bi-bag-check-fill' : 'bi-chat-square-text'
                                  } text-base`}
                                ></i>
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-extrabold text-sm text-slate-900 truncate max-w-[180px]">
                                    {displayName}
                                  </span>
                                  {isConfirmed ? (
                                    <>
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                        ✓ Confirmada
                                      </span>
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                        {conv.confirmedOrderSource === 'checkout' ? 'Checkout' : 'Manual'}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">
                                      Cerrada sin pedido
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] text-slate-500">
                                  {conv.phone && (
                                    <span className="font-bold text-slate-600">
                                      <i className="bi bi-telephone mr-1"></i>
                                      {conv.phone}
                                    </span>
                                  )}
                                  <span>•</span>
                                  <span>
                                    {formatRelativeTime(
                                      conv.resolvedAtMillis ||
                                        conv.confirmedAtMillis ||
                                        conv.closedAtMillis ||
                                        conv.timestampMillis
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="relative shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenMenuDocId(openMenuDocId === `res_${conv.docId}` ? null : `res_${conv.docId}`)
                                }
                                className="p-1 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100"
                                title="Más opciones"
                                aria-label="Más opciones"
                              >
                                <i className="bi bi-three-dots-vertical text-sm"></i>
                              </button>
                              {openMenuDocId === `res_${conv.docId}` && (
                                <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-30">
                                  {onExcludeConversation && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenMenuDocId(null)
                                        onExcludeConversation(conv)
                                      }}
                                      className="w-full px-3 py-2 text-left hover:bg-red-50 flex items-start gap-2 transition-colors"
                                    >
                                      <i className="bi bi-slash-circle text-red-600 text-xs mt-0.5"></i>
                                      <div>
                                        <p className="text-xs font-bold text-red-600">Excluir</p>
                                        <p className="text-[10px] text-slate-500">
                                          No notificar de este número
                                        </p>
                                      </div>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuDocId(null)
                                      onRemoveConversation(conv.docId)
                                    }}
                                    className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-xs font-semibold text-slate-700 transition-colors"
                                  >
                                    <i className="bi bi-trash3 text-slate-500"></i>
                                    <span>Eliminar del historial</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Order Trail Block for Confirmed Conversations */}
                          {isConfirmed && conv.confirmedOrderId && (
                            <div className="mt-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/80 p-2.5">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${orderStatusMeta.className}`}
                                  >
                                    {orderStatusMeta.label}
                                  </span>
                                  {orderTotal !== null && (
                                    <span className="text-xs font-extrabold text-emerald-800">
                                      ${Number(orderTotal).toFixed(2)}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                  {onInspectOrder && (
                                    <button
                                      type="button"
                                      onClick={() => onInspectOrder(String(conv.confirmedOrderId), linkedOrder)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition-colors"
                                    >
                                      <i className="bi bi-box-arrow-up-right"></i>
                                      <span>Ver orden</span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              {orderSummary && (
                                <p className="text-[11px] text-emerald-900 mt-1.5 line-clamp-2">
                                  🛍️ {orderSummary}
                                </p>
                              )}

                              {isTraceOpen && (
                                <div className="mt-2 pt-2 border-t border-emerald-200/80 space-y-1.5 text-[11px] text-slate-700">
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-slate-500">Origen de venta:</span>
                                    <span className="font-bold text-slate-800">
                                      {conv.confirmedOrderSource === 'checkout'
                                        ? 'Checkout Web (Cliente)'
                                        : 'Pedido Manual (Tienda)'}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-slate-500">Mensaje WhatsApp:</span>
                                    <span>{formatRelativeTime(conv.timestampMillis)}</span>
                                  </div>
                                  {conv.confirmedAtMillis && (
                                    <div className="flex items-center justify-between">
                                      <span className="font-semibold text-slate-500">Confirmada:</span>
                                      <span>{formatRelativeTime(conv.confirmedAtMillis)}</span>
                                    </div>
                                  )}
                                  {linkedOrder?.delivery?.type && (
                                    <div className="flex items-center justify-between">
                                      <span className="font-semibold text-slate-500">Entrega:</span>
                                      <span className="font-bold">
                                        {linkedOrder.delivery.type === 'pickup' ? 'Retiro en tienda' : 'Domicilio'}
                                      </span>
                                    </div>
                                  )}
                                  {(linkedOrder?.delivery?.assignedDeliveryData?.nombres ||
                                    linkedOrder?.delivery?.assignedDeliveryData?.name) && (
                                    <div className="flex items-center justify-between">
                                      <span className="font-semibold text-slate-500">Repartidor:</span>
                                      <span className="font-bold text-emerald-800">
                                        🛵{' '}
                                        {linkedOrder.delivery.assignedDeliveryData.nombres ||
                                          linkedOrder.delivery.assignedDeliveryData.name}
                                      </span>
                                    </div>
                                  )}
                                  {linkedOrder?.payment?.method && (
                                    <div className="flex items-center justify-between">
                                      <span className="font-semibold text-slate-500">Pago:</span>
                                      <span className="font-bold capitalize">
                                        {linkedOrder.payment.method} (
                                        {linkedOrder.payment.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente'})
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {previewMessages.length > 0 && (
                            <div className="mt-2 rounded-lg bg-slate-100 px-2.5 py-1.5 space-y-0.5">
                              {previewMessages.map((msg, idx) => (
                                <p key={idx} className="text-[11px] text-slate-600 line-clamp-1">
                                  💬 {msg}
                                </p>
                              ))}
                            </div>
                          )}

                          <div className="mt-2.5 flex items-center justify-end gap-2">
                            {onReopenConversation && !isConfirmed && (
                              <button
                                type="button"
                                onClick={() => onReopenConversation(conv.docId)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition-colors"
                              >
                                <i className="bi bi-arrow-counterclockwise"></i>
                                <span>Reabrir</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onSelectConversation(conv)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[11px] font-bold transition-colors"
                            >
                              <i className="bi bi-cart-plus"></i>
                              <span>{isConfirmed ? 'Pide algo más' : 'Crear pedido'}</span>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showExcludedModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setShowExcludedModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <i className="bi bi-gear text-slate-700"></i>
                <h4 className="text-sm font-extrabold text-slate-900">
                  Números excluidos ({excludedContacts.length})
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setShowExcludedModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100"
              >
                <i className="bi bi-x-lg text-xs"></i>
              </button>
            </div>
            <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
              <p className="text-xs text-slate-500 mb-2">
                Los contactos en esta lista no generan notificaciones ni aparecen en Mensajes de WhatsApp.
              </p>
              {excludedContacts.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                  No hay números excluidos. Usa el botón de 3 puntos en cualquier tarjeta para excluir a quien no sea cliente.
                </div>
              ) : (
                excludedContacts.map((ex) => (
                  <div
                    key={ex.docId}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {ex.displayName || ex.phone || 'Contacto excluido'}
                      </p>
                      {ex.phone && ex.phone !== ex.displayName && (
                        <p className="text-[11px] text-slate-500">{ex.phone}</p>
                      )}
                    </div>
                    {onUnexcludeContact && (
                      <button
                        type="button"
                        onClick={() => onUnexcludeContact(ex.docId)}
                        className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-[11px] font-bold text-slate-700 shrink-0"
                      >
                        Sacar
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowExcludedModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
