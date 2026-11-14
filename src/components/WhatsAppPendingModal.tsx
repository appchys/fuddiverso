'use client'

import React, { useMemo, useState } from 'react'

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
}

interface WhatsAppPendingModalProps {
  isOpen: boolean
  conversations: PendingWhatsAppConversation[]
  onClose: () => void
  onSelectConversation: (conversation: PendingWhatsAppConversation) => void
  onRemoveConversation: (docId: string) => void
  onClearAll: () => void
}

function formatRelativeTime(timestampMillis: number): string {
  const diff = Date.now() - (timestampMillis || Date.now())
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

export default function WhatsAppPendingModal({
  isOpen,
  conversations,
  onClose,
  onSelectConversation,
  onRemoveConversation,
  onClearAll
}: WhatsAppPendingModalProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((conv) => {
      const name = (conv.effectiveName || conv.fuddiClientName || conv.displayName || '').toLowerCase()
      const phone = (conv.phone || '').toLowerCase()
      const msg = (conv.lastMessage || '').toLowerCase()
      return name.includes(q) || phone.includes(q) || msg.includes(q)
    })
  }, [conversations, searchQuery])

  if (!isOpen) return null

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
              {conversations.length > 0 && (
                <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-green-600 text-white">
                  {conversations.length}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {conversations.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 transition-colors"
              >
                <i className="bi bi-trash3"></i>
                <span>Limpiar</span>
              </button>
            )}
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
                placeholder="Buscar por nombre, celular o mensaje..."
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

          {filteredConversations.length === 0 ? (
            <div className="py-12 px-6 text-center flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center mb-3.5">
                <i className="bi bi-chat-dots text-slate-500 text-2xl"></i>
              </div>
              <p className="text-sm font-bold text-slate-700">
                {searchQuery.trim()
                  ? `No se encontraron clientes para "${searchQuery}"`
                  : 'No hay conversaciones pendientes'}
              </p>
              <p className="text-xs text-slate-500 mt-1.5 max-w-xs leading-relaxed">
                Cuando un cliente te escriba por WhatsApp Business en la app móvil, aparecerá aquí sincronizado para crear su pedido con un clic.
              </p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
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

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveConversation(conv.docId)
                      }}
                      className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 shrink-0"
                      aria-label="Descartar conversación"
                    >
                      <i className="bi bi-x-lg text-xs"></i>
                    </button>
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

                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    {conv.detectedLocationLink ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-100 text-sky-800 text-[11px] font-bold">
                        <i className="bi bi-geo-alt-fill text-sky-600"></i>
                        Ubicación incluida
                      </span>
                    ) : (
                      <span />
                    )}

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
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
