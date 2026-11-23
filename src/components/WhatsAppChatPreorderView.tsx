'use client'

import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { collection, doc, getDoc, updateDoc, addDoc, deleteDoc, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Product } from '@/types'
import type { PendingWhatsAppConversation } from '@/components/WhatsAppPendingModal'
import { searchClientByPhone, getClientLocations, createClient, generateProductSlug, type ClientLocation } from '@/lib/database'
import { ClientLocationsModal } from '@/components/ClientLocationsModal'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'
import { getManualOrderStorePrice, getPriceMetadata } from '@/lib/price-utils'
import { Motorbike } from 'lucide-react'
import type { WhatsAppPreorderDraft, WhatsAppPreorderDraftItem } from '@/components/LiveCheckoutsPanel'
import { usePersistedPreorderState, buildBasePreorderState } from '@/hooks/usePersistedPreorderState'

export type PreorderTabKey = 'products' | 'timing' | 'delivery' | 'payment'

export interface ResolvedWhatsAppClientProfile {
  clientId?: string
  clientName?: string
  clientPhone?: string
  clientEmail?: string
  clientNotes?: string
  isRegistered: boolean
  locations: ClientLocation[]
}

function normalizeSearchBase(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function phoneticSpanish(word: string): string {
  return word
    .replace(/ch/g, 'X')
    .replace(/h/g, '')
    .replace(/X/g, 'ch')
    .replace(/(?:gu|hu|wu|w)/g, 'u')
    .replace(/v/g, 'b')
    .replace(/qu/g, 'k')
    .replace(/c(?=[ei])/g, 's')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/ll/g, 'y')
    .replace(/([a-z])\1+/g, '$1')
}

function stripSpanishSuffix(word: string): string {
  if (word.length <= 4) return word
  const stripped = word
    .replace(/(?:sitos|sitas|sito|sita|itos|itas|ito|ita)$/, '')
    .replace(/(?:es|s)$/, '')
  return stripped.length >= 3 ? stripped : word
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  const prev = new Array<number>(n + 1)
  const curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]
  }
  return prev[n]
}

const WHATSAPP_SEARCH_STOPWORDS = new Set([
  'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'dispone', 'disponen',
  'tiene', 'tienen', 'quiero', 'quisiera', 'deseo', 'dame', 'deme', 'regaleme',
  'por', 'favor', 'porfa', 'porfavor', 'para', 'con', 'sin', 'del', 'las', 'los',
  'una', 'uno', 'unos', 'unas', 'que', 'puede', 'puedes', 'pueden', 'enviar',
  'envio', 'mandar', 'mande', 'pedido', 'pedir', 'ayuda', 'ayudeme', 'gracias',
  'cuanto', 'cuesta', 'vale', 'precio', 'hay', 'aun', 'todavia', 'ahora', 'hoy',
])

function scoreProductSmartMatch(product: Product, rawQuery: string): number {
  const cleanQuery = normalizeSearchBase(rawQuery)
  if (!cleanQuery) return 1

  const variantNames = (product.variants || []).map(v => v.name || '')
  const fullTextNorm = normalizeSearchBase(
    [product.name, ...variantNames, product.category || '', product.description || ''].join(' ')
  )
  const nameAndVariantsNorm = normalizeSearchBase([product.name, ...variantNames].join(' '))

  if (nameAndVariantsNorm.includes(cleanQuery)) return 120
  if (fullTextNorm.includes(cleanQuery)) return 85

  const rawTokens = cleanQuery.split(' ').filter(Boolean)
  const meaningfulTokens = rawTokens.filter(t => {
    if (/^\d+$/.test(t)) return true
    return t.length >= 3 && !WHATSAPP_SEARCH_STOPWORDS.has(t)
  })
  const queryTokens = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens.filter(t => t.length >= 2)
  if (queryTokens.length === 0) return 0

  const primaryWords = nameAndVariantsNorm.split(' ').filter(Boolean)
  const allWords = fullTextNorm.split(' ').filter(Boolean)
  const primaryPhonetic = primaryWords.map(w => ({
    raw: w,
    phon: phoneticSpanish(w),
    stem: stripSpanishSuffix(phoneticSpanish(w)),
  }))
  const secondaryPhonetic = allWords
    .filter(w => !primaryWords.includes(w))
    .map(w => ({
      raw: w,
      phon: phoneticSpanish(w),
      stem: stripSpanishSuffix(phoneticSpanish(w)),
    }))

  let totalScore = 0
  let matchedWordTokens = 0

  for (const token of queryTokens) {
    if (/^\d+$/.test(token)) {
      if (primaryWords.includes(token)) totalScore += 22
      continue
    }

    const qPhon = phoneticSpanish(token)
    const qStem = stripSpanishSuffix(qPhon)
    let bestTokenScore = 0

    const evaluateAgainst = (
      candidates: Array<{ raw: string; phon: string; stem: string }>,
      multiplier: number
    ) => {
      for (const c of candidates) {
        let s = 0
        if (c.raw === token || c.phon === qPhon || c.stem === qStem) {
          s = 65
        } else if (
          (qStem.length >= 3 && (c.phon.includes(qStem) || c.stem.includes(qStem))) ||
          (c.stem.length >= 3 && (qPhon.includes(c.stem) || qStem.includes(c.stem)))
        ) {
          s = 52
        } else if (qStem.length >= 4 && c.stem.length >= 4) {
          const dist = levenshteinDistance(qStem, c.stem)
          const maxLen = Math.max(qStem.length, c.stem.length)
          const similarity = 1 - dist / maxLen
          if (dist <= 1 || (maxLen >= 6 && dist <= 2) || similarity >= 0.65) {
            s = Math.round(48 * similarity)
          } else if (c.phon.length >= qStem.length) {
            const prefix = c.phon.slice(0, qStem.length)
            if (levenshteinDistance(qStem, prefix) <= 1) {
              s = 38
            }
          }
        }
        const weighted = Math.round(s * multiplier)
        if (weighted > bestTokenScore) bestTokenScore = weighted
      }
    }

    evaluateAgainst(primaryPhonetic, 1)
    if (bestTokenScore < 35) evaluateAgainst(secondaryPhonetic, 0.55)

    if (bestTokenScore > 0) {
      matchedWordTokens++
      totalScore += bestTokenScore
    }
  }

  if (matchedWordTokens >= 2) {
    totalScore += matchedWordTokens * 10
  }
  return totalScore
}

function formatEcuadorPhoneDisplay(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed || !/^[\d\s+\-().]+$/.test(trimmed)) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  let local = ''
  if (digits.length === 10 && digits.startsWith('09')) local = digits.slice(1)
  else if (digits.length === 12 && digits.startsWith('5939')) local = digits.slice(3)
  else if (digits.length === 9 && digits.startsWith('9')) local = digits
  if (local.length === 9) {
    return `+593 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`
  }
  return trimmed
}

function cleanWhatsAppDisplayName(
  candidates: Array<string | undefined | null>,
  fallbackPhone?: string
): string {
  for (const raw of candidates) {
    const trimmed = (raw || '').trim()
    if (!trimmed) continue
    const match = trimmed.match(/^cliente\s*\(([^)]+)\)$/i)
    if (match?.[1]) return formatEcuadorPhoneDisplay(match[1].trim())
    return formatEcuadorPhoneDisplay(trimmed)
  }
  return formatEcuadorPhoneDisplay((fallbackPhone || '').trim()) || 'WhatsApp'
}

function formatWhatsAppTime(dateInput: Date | number | undefined | null): string {
  if (!dateInput) return ''
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput)
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

const QUICK_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🙏', '👌']

function getTodayDateString(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function extractLocationPreviewFromMessage(rawText?: string | null): {
  lat: string
  lng: string
  mapsUrl: string
  staticMapUrl: string
  label: string
  extraText: string
} | null {
  const text = String(rawText || '').trim()
  if (!text) return null
  const urlMatch = text.match(/https?:\/\/(?:www\.)?(?:google\.com\/maps|maps\.google\.com)[^\s]+/i)
  if (!urlMatch) return null
  const matchedUrl = urlMatch[0]
  const coordMatch = matchedUrl.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/)
  if (!coordMatch) return null
  const lat = coordMatch[1]
  const lng = coordMatch[2]
  const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`
  const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=480x240&scale=2&maptype=roadmap&markers=color:red%7C${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`

  const withoutUrl = text
    .replace(matchedUrl, '')
    .replace(/:\s*$/, '')
    .trim()

  const isLive = /tiempo real/i.test(withoutUrl)
  const label = withoutUrl
    ? withoutUrl.replace(/^📍\s*/, '').trim()
    : isLive
      ? 'Ubicación en tiempo real'
      : 'Ubicación enviada'

  return {
    lat,
    lng,
    mapsUrl,
    staticMapUrl,
    label: label || 'Ubicación enviada',
    extraText: '',
  }
}

interface WhatsAppChatPreorderViewProps {
  businessId?: string
  conversation: PendingWhatsAppConversation
  initialTab?: PreorderTabKey
  initialProfile?: ResolvedWhatsAppClientProfile
  activeOrder?: any
  clientOrders?: any[]
  products?: Product[]
  onBack: () => void
  onCreateOrder: (conv: PendingWhatsAppConversation, draft?: WhatsAppPreorderDraft) => void
  onCloseConversation?: (docId: string) => void
  onInspectOrder?: (order: any) => void
}

export function WhatsAppChatPreorderView({
  businessId,
  conversation,
  initialTab,
  initialProfile,
  activeOrder,
  clientOrders = [],
  products = [],
  onBack,
  onCreateOrder,
  onCloseConversation,
  onInspectOrder,
}: WhatsAppChatPreorderViewProps) {
  const [activeTab, setActiveTab] = useState<PreorderTabKey | null>(initialTab ?? null)
  const [resolvedProfile, setResolvedProfile] = useState<ResolvedWhatsAppClientProfile | undefined>(initialProfile)
  const [showLocationsModal, setShowLocationsModal] = useState(false)

  // Estado de preorden
  const [draftItems, setDraftItems] = useState<WhatsAppPreorderDraftItem[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [timingType, setTimingType] = useState<'' | 'immediate' | 'scheduled'>('')
  const [scheduledDate, setScheduledDate] = useState<string>(getTodayDateString)
  const [scheduledTime, setScheduledTime] = useState<string>('')
  const [deliveryType, setDeliveryType] = useState<'' | 'delivery' | 'pickup'>('')
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [customLocationInput, setCustomLocationInput] = useState<string>(conversation.detectedLocationLink || '')
  const [paymentMethod, setPaymentMethod] = useState<'' | 'cash' | 'transfer' | 'mixed'>('')
  const [cashAmountInput, setCashAmountInput] = useState<string>('')
  const [transferAmountInput, setTransferAmountInput] = useState<string>('')
  const [newClientName, setNewClientName] = useState<string>('')
  const [isEditingClientName, setIsEditingClientName] = useState<boolean>(false)
  const [savingNewClient, setSavingNewClient] = useState<boolean>(false)
  const [replyText, setReplyText] = useState<string>('')
  const [sendingReply, setSendingReply] = useState<boolean>(false)
  const [optimisticReply, setOptimisticReply] = useState<{
    id: string
    text: string
    linkPreview?: {
      url: string
      matchedText?: string
      title?: string
      description?: string
      image?: string | null
      siteName?: string
    } | null
  } | null>(null)
  const [draftLinkPreview, setDraftLinkPreview] = useState<{
    url: string
    matchedText: string
    title: string
    description: string
    image: string | null
    siteName: string
  } | null>(null)
  const [loadingLinkPreview, setLoadingLinkPreview] = useState<boolean>(false)
  const [dismissedPreviewUrl, setDismissedPreviewUrl] = useState<string | null>(null)
  const [previewImageModal, setPreviewImageModal] = useState<{ url: string; caption?: string } | null>(null)
  const [showHeaderMenu, setShowHeaderMenu] = useState<boolean>(false)
  const [showAttachMenu, setShowAttachMenu] = useState<boolean>(false)
  const [attachMenuView, setAttachMenuView] = useState<'main' | 'products'>('main')
  const [attachProductSearch, setAttachProductSearch] = useState<string>('')
  const [businessUsername, setBusinessUsername] = useState<string>('')
  const [customQuickReplies, setCustomQuickReplies] = useState<
    Array<{ id: string; shortcut: string; message: string; isDefault?: boolean }>
  >([])
  const [quickReplySelectedIdx, setQuickReplySelectedIdx] = useState<number>(0)
  const [quickReplyDismissed, setQuickReplyDismissed] = useState<boolean>(false)
  const [showNewQuickReplyForm, setShowNewQuickReplyForm] = useState<boolean>(false)
  const [editingQuickReplyId, setEditingQuickReplyId] = useState<string | null>(null)
  const [newQuickShortcut, setNewQuickShortcut] = useState<string>('')
  const [newQuickMessage, setNewQuickMessage] = useState<string>('')
  const [savingQuickReply, setSavingQuickReply] = useState<boolean>(false)
  const [openReactionMsgKey, setOpenReactionMsgKey] = useState<string | null>(null)
  const [optimisticReactions, setOptimisticReactions] = useState<Record<string, string | null>>({})
  const headerMenuRef = useRef<HTMLDivElement | null>(null)
  const attachMenuRef = useRef<HTMLDivElement | null>(null)
  const replyInputRef = useRef<HTMLInputElement | null>(null)
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const isInitialScrollPendingRef = useRef<boolean>(true)

  const scrollMessagesToBottom = useCallback((smooth = false) => {
    const el = messagesScrollRef.current
    if (!el) return
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  const chatMessageCount = Array.isArray(conversation.chatHistory)
    ? conversation.chatHistory.length
    : (conversation.recentMessages?.length || 0) + (conversation.sentReplies?.length || 0)

  const lastChatTimestamp = Array.isArray(conversation.chatHistory) && conversation.chatHistory.length > 0
    ? conversation.chatHistory[conversation.chatHistory.length - 1]?.timestampMillis || 0
    : conversation.timestampMillis || 0

  useLayoutEffect(() => {
    isInitialScrollPendingRef.current = true
    scrollMessagesToBottom(false)
    const raf = requestAnimationFrame(() => scrollMessagesToBottom(false))
    const t = setTimeout(() => {
      scrollMessagesToBottom(false)
      isInitialScrollPendingRef.current = false
    }, 120)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [conversation.docId, scrollMessagesToBottom])

  useEffect(() => {
    if (!showHeaderMenu) return
    const handleOutsideClick = (event: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(event.target as Node)) {
        setShowHeaderMenu(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [showHeaderMenu])

  useEffect(() => {
    if (!showAttachMenu) return
    const handleOutsideClick = (event: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(event.target as Node)) {
        setShowAttachMenu(false)
        setAttachMenuView('main')
        setAttachProductSearch('')
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [showAttachMenu])

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    getDoc(doc(db, 'businesses', businessId))
      .then((snap) => {
        if (!cancelled && snap.exists()) {
          const uname = String(snap.data()?.username || '').trim()
          if (uname) setBusinessUsername(uname)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [businessId])

  useEffect(() => {
    if (!businessId) return
    const q = query(
      collection(db, 'businesses', businessId, 'quickReplies'),
      orderBy('shortcut', 'asc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => {
            const data = d.data() || {}
            const shortcut = String(data.shortcut || '').trim().replace(/^\/+/, '').toLowerCase()
            const message = String(data.message || '').trim()
            if (!shortcut || !message) return null
            return { id: d.id, shortcut, message }
          })
          .filter(Boolean) as Array<{ id: string; shortcut: string; message: string }>
        setCustomQuickReplies(list)
      },
      () => {}
    )
    return () => unsub()
  }, [businessId])

  const defaultQuickReplies = useMemo(() => {
    const defaults: Array<{ id: string; shortcut: string; message: string; isDefault?: boolean }> = [
      {
        id: 'def-hola',
        shortcut: 'hola',
        message: '¡Hola! 👋 Gracias por escribirnos. ¿En qué te podemos ayudar hoy?',
        isDefault: true,
      },
      ...(businessUsername
        ? [
            {
              id: 'def-menu',
              shortcut: 'menu',
              message: `Aquí puedes ver nuestro menú completo y hacer tu pedido: https://www.fuddi.shop/${businessUsername}`,
              isDefault: true,
            },
          ]
        : []),
      {
        id: 'def-ubicacion',
        shortcut: 'ubicacion',
        message: 'Por favor compártenos tu ubicación 📍 para calcular el envío y despachar tu pedido.',
        isDefault: true,
      },
      {
        id: 'def-pago',
        shortcut: 'pago',
        message: '¿Tu pago sería en efectivo 💵 o transferencia bancaria 🏦?',
        isDefault: true,
      },
      {
        id: 'def-gracias',
        shortcut: 'gracias',
        message: '¡Muchas gracias por tu pedido! 🙌 Ya lo estamos preparando.',
        isDefault: true,
      },
    ]
    return defaults
  }, [businessUsername])

  const allQuickReplies = useMemo(() => {
    if (customQuickReplies.length > 0) return customQuickReplies
    return defaultQuickReplies
  }, [customQuickReplies, defaultQuickReplies])

  const slashMatch = useMemo(() => {
    const m = replyText.match(/(^|\s)\/([^\s]*)$/)
    if (!m) return null
    return {
      query: (m[2] || '').toLowerCase(),
      fullTokenLength: (m[1]?.length || 0) + 1 + (m[2]?.length || 0),
      prefix: m[1] || '',
    }
  }, [replyText])

  const filteredQuickReplies = useMemo(() => {
    if (!slashMatch) return []
    const q = slashMatch.query
    if (!q) return allQuickReplies
    return allQuickReplies.filter(
      (item) =>
        item.shortcut.toLowerCase().includes(q) ||
        item.message.toLowerCase().includes(q)
    )
  }, [slashMatch, allQuickReplies])

  const isQuickReplyMenuOpen = Boolean(slashMatch && !quickReplyDismissed)

  useEffect(() => {
    setQuickReplySelectedIdx(0)
    if (!slashMatch) {
      setQuickReplyDismissed(false)
      setShowNewQuickReplyForm(false)
    }
  }, [slashMatch?.query, Boolean(slashMatch)])

  const applyQuickReply = useCallback(
    (message: string) => {
      setDismissedPreviewUrl(null)
      setReplyText((prev) => {
        const m = prev.match(/(^|\s)\/([^\s]*)$/)
        if (!m) return message
        const before = prev.slice(0, prev.length - m[0].length)
        const spacer = m[1] || ''
        return `${before}${spacer}${message}`
      })
      setQuickReplyDismissed(false)
      setShowNewQuickReplyForm(false)
      setTimeout(() => replyInputRef.current?.focus(), 20)
    },
    []
  )

  const handleSaveQuickReply = async () => {
    const cleanShortcut = newQuickShortcut.trim().replace(/^\/+/, '').replace(/\s+/g, '').toLowerCase()
    const cleanMessage = newQuickMessage.trim()
    if (!businessId || !cleanShortcut || !cleanMessage || savingQuickReply) return
    setSavingQuickReply(true)
    try {
      const colRef = collection(db, 'businesses', businessId, 'quickReplies')
      const now = Date.now()

      if (editingQuickReplyId && !editingQuickReplyId.startsWith('def-')) {
        // Editar una respuesta personalizada existente en Firestore
        await updateDoc(doc(db, 'businesses', businessId, 'quickReplies', editingQuickReplyId), {
          shortcut: cleanShortcut,
          message: cleanMessage,
          updatedAtMillis: now,
        })
      } else if (customQuickReplies.length === 0) {
        // Primera vez que se crea o edita una predeterminada: sembrar todas en Firestore aplicando el cambio
        const toSeed = defaultQuickReplies.map((item) =>
          item.id === editingQuickReplyId
            ? { shortcut: cleanShortcut, message: cleanMessage }
            : { shortcut: item.shortcut, message: item.message }
        )
        if (!editingQuickReplyId) {
          toSeed.push({ shortcut: cleanShortcut, message: cleanMessage })
        }
        await Promise.all(
          toSeed.map((entry, idx) =>
            addDoc(colRef, {
              shortcut: entry.shortcut,
              message: entry.message,
              createdAtMillis: now + idx,
            })
          )
        )
      } else {
        await addDoc(colRef, {
          shortcut: cleanShortcut,
          message: cleanMessage,
          createdAtMillis: now,
        })
      }

      setEditingQuickReplyId(null)
      setNewQuickShortcut('')
      setNewQuickMessage('')
      setShowNewQuickReplyForm(false)
    } catch (err) {
      console.error('[QuickReplies] Error guardando respuesta rápida:', err)
    } finally {
      setSavingQuickReply(false)
    }
  }

  const handleStartEditQuickReply = (item: { id: string; shortcut: string; message: string }) => {
    setEditingQuickReplyId(item.id)
    setNewQuickShortcut(item.shortcut)
    setNewQuickMessage(item.message)
    setShowNewQuickReplyForm(true)
  }

  const handleDeleteQuickReply = async (item: { id: string; isDefault?: boolean }) => {
    if (!businessId || !item.id) return
    try {
      if (item.isDefault && customQuickReplies.length === 0) {
        const colRef = collection(db, 'businesses', businessId, 'quickReplies')
        const now = Date.now()
        const remaining = defaultQuickReplies.filter((d) => d.id !== item.id)
        await Promise.all(
          remaining.map((entry, idx) =>
            addDoc(colRef, {
              shortcut: entry.shortcut,
              message: entry.message,
              createdAtMillis: now + idx,
            })
          )
        )
        return
      }
      await deleteDoc(doc(db, 'businesses', businessId, 'quickReplies', item.id))
    } catch (err) {
      console.error('[QuickReplies] Error eliminando respuesta rápida:', err)
    }
  }

  const attachableProducts = useMemo(() => {
    const available = products.filter((p) => p.isAvailable !== false)
    const term = attachProductSearch.trim().toLowerCase()
    if (!term) return available
    return available.filter((p) =>
      String(p.name || '').toLowerCase().includes(term) ||
      String(p.description || '').toLowerCase().includes(term)
    )
  }, [products, attachProductSearch])

  const insertLinkIntoReply = useCallback((url: string) => {
    setDismissedPreviewUrl(null)
    setReplyText((prev) => {
      const trimmed = prev.trim()
      return trimmed ? `${trimmed} ${url}` : url
    })
    setShowAttachMenu(false)
    setAttachMenuView('main')
    setAttachProductSearch('')
    setTimeout(() => replyInputRef.current?.focus(), 30)
  }, [])

  useEffect(() => {
    scrollMessagesToBottom(false)
    const raf = requestAnimationFrame(() => scrollMessagesToBottom(false))
    return () => cancelAnimationFrame(raf)
  }, [chatMessageCount, lastChatTimestamp, optimisticReply?.id, activeTab, clientOrders.length, activeOrder?.id, scrollMessagesToBottom])

  useEffect(() => {
    const match = replyText.match(/https?:\/\/[^\s<>()]+/i)
    const detectedUrl = match?.[0]?.replace(/[.,;!?)]+$/, '') || null

    if (!detectedUrl) {
      setDraftLinkPreview(null)
      setLoadingLinkPreview(false)
      setDismissedPreviewUrl(null)
      return
    }

    if (dismissedPreviewUrl === detectedUrl) {
      setDraftLinkPreview(null)
      setLoadingLinkPreview(false)
      return
    }

    if (draftLinkPreview?.matchedText === detectedUrl) {
      return
    }

    let cancelled = false
    setLoadingLinkPreview(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/whatsapp/link-preview?url=${encodeURIComponent(detectedUrl)}`,
          { cache: 'no-store' }
        )
        if (!cancelled && res.ok) {
          const data = await res.json()
          setDraftLinkPreview(data?.preview || null)
        }
      } catch {
        if (!cancelled) setDraftLinkPreview(null)
      } finally {
        if (!cancelled) setLoadingLinkPreview(false)
      }
    }, 450)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [replyText, dismissedPreviewUrl, draftLinkPreview?.matchedText])

  const handleReactToMessage = async (msg: any, emoji: string) => {
    const msgId = String(msg?.id || '').trim()
    if (!businessId || !conversation.docId || !msgId) return
    const existingList: Array<{ emoji: string; fromMe: boolean }> = Array.isArray(msg?.reactions)
      ? msg.reactions
      : []
    const currentMyEmoji =
      optimisticReactions[msgId] !== undefined
        ? optimisticReactions[msgId]
        : existingList.find((r) => r?.fromMe)?.emoji || null
    const nextEmoji = currentMyEmoji === emoji ? '' : emoji

    setOpenReactionMsgKey(null)
    setOptimisticReactions((prev) => ({ ...prev, [msgId]: nextEmoji || null }))

    const targetPhone =
      resolvedProfile?.clientPhone || conversation.phone || conversation.rawPhone || ''
    try {
      await fetch('/api/whatsapp/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'react',
          businessId,
          docId: conversation.docId,
          phone: targetPhone,
          messageId: msg.waMsgId || msgId,
          fromMe: Boolean(msg.fromMe),
          emoji: nextEmoji,
        }),
      })
    } catch {
      // Ignorar fallo transitorio de red
    }
  }

  const handleSendDirectReply = async () => {
    const cleanText = replyText.trim()
    if (!cleanText || !businessId || !conversation.docId || sendingReply) return
    const previewToSend = dismissedPreviewUrl
      ? null
      : draftLinkPreview || undefined
    setReplyText('')
    setDraftLinkPreview(null)
    setLoadingLinkPreview(false)
    setDismissedPreviewUrl(null)
    setSendingReply(true)
    const replyId = `web_${Date.now()}`
    setOptimisticReply({ id: replyId, text: cleanText, linkPreview: previewToSend || null })
    const targetPhone =
      resolvedProfile?.clientPhone || conversation.phone || conversation.rawPhone || ''
    try {
      // 1. Intentar envío directo por el puente multi-dispositivo (Baileys) si está conectado
      let sentViaBaileys = false
      try {
        const res = await fetch('/api/whatsapp/bridge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send',
            businessId,
            docId: conversation.docId,
            phone: targetPhone,
            text: cleanText,
            replyId,
            ...(previewToSend !== undefined ? { linkPreview: previewToSend } : {}),
          }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data?.ok) {
            sentViaBaileys = true
          }
        }
      } catch {
        // Si no está activo en este servidor, continuar con el puente de Firestore
      }

      // 2. Si no se envió directo en la llamada HTTP, encolar en Firestore para que lo despache el worker de Baileys o la notificación activa del teléfono Android
      if (!sentViaBaileys) {
        await updateDoc(doc(db, 'businesses', businessId, 'whatsappPending', conversation.docId), {
          pendingReply: {
            id: replyId,
            text: cleanText,
            status: 'pending',
            requestedAtMillis: Date.now(),
          },
        })
      }
    } catch (err) {
      console.error('[WhatsAppChatView] Error requesting direct reply:', err)
    } finally {
      setOptimisticReply(null)
      setSendingReply(false)
    }
  }

  // Persistir la preorden en Firestore (compartida con la tarjeta de "Clientes comprando ahora")
  const [basePreorderState] = useState(() => buildBasePreorderState(conversation.detectedLocationLink))
  usePersistedPreorderState({
    businessId,
    docId: conversation.docId,
    remoteState: conversation.preorderState,
    baseState: basePreorderState,
    localState: {
      items: draftItems,
      timingType,
      scheduledDate,
      scheduledTime,
      deliveryType,
      selectedLocationId,
      customLocationInput,
      paymentMethod,
      cashAmountInput,
      transferAmountInput,
    },
    applyState: (s) => {
      setDraftItems(s.items)
      setTimingType(s.timingType)
      setScheduledDate(s.scheduledDate)
      setScheduledTime(s.scheduledTime)
      setDeliveryType(s.deliveryType)
      setSelectedLocationId(s.selectedLocationId)
      setCustomLocationInput(s.customLocationInput)
      setPaymentMethod(s.paymentMethod)
      setCashAmountInput(s.cashAmountInput)
      setTransferAmountInput(s.transferAmountInput)
    },
  })

  const focusedFieldRef = useRef<'clientName' | 'productSearch' | 'customLocation' | 'cashAmount' | 'transferAmount' | null>(null)
  const clientNameInputRef = useRef<HTMLInputElement | null>(null)
  const productSearchInputRef = useRef<HTMLInputElement | null>(null)
  const customLocationInputRef = useRef<HTMLInputElement | null>(null)
  const cashAmountInputRef = useRef<HTMLInputElement | null>(null)
  const transferAmountInputRef = useRef<HTMLInputElement | null>(null)

  // Resolver perfil del cliente si no vino precargado
  useEffect(() => {
    if (resolvedProfile) return
    let cancelled = false
    const candidatePhone = (conversation.phone || conversation.rawPhone || '').trim()
    const existingClientId = (conversation.fuddiClientId || '').trim()
    if (!existingClientId && candidatePhone.replace(/\D/g, '').length < 9) return

    ;(async () => {
      try {
        let clientId = existingClientId
        let clientName = (conversation.fuddiClientName || '').trim()
        let clientPhone = candidatePhone
        let clientEmail = (conversation.fuddiClientEmail || '').trim()
        let clientNotes = (conversation.fuddiClientNotes || '').trim()
        let isRegistered = Boolean(conversation.isRegisteredClient && clientId)

        if (!clientId && candidatePhone.replace(/\D/g, '').length >= 9) {
          const found = await searchClientByPhone(candidatePhone)
          if (found) {
            clientId = found.id
            clientName = (found.nombres || '').trim() || clientName
            clientPhone = (found.celular || '').trim() || clientPhone
            clientEmail = (found.email || '').trim() || clientEmail
            clientNotes = (found.notas || '').trim() || clientNotes
            isRegistered = true
          }
        }
        const locations = clientId ? await getClientLocations(clientId) : []
        if (!cancelled) {
          setResolvedProfile({
            clientId: clientId || undefined,
            clientName: clientName || undefined,
            clientPhone: clientPhone || undefined,
            clientEmail: clientEmail || undefined,
            clientNotes: clientNotes || undefined,
            isRegistered,
            locations,
          })
        }
      } catch (err) {
        console.error('[WhatsAppChatView] Error resolving client:', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [conversation, resolvedProfile])

  const displayName = cleanWhatsAppDisplayName(
    [
      resolvedProfile?.clientName,
      conversation.fuddiClientName,
      conversation.effectiveName,
      conversation.displayName,
    ],
    resolvedProfile?.clientPhone || conversation.phone || conversation.rawPhone
  )

  const isRegisteredClient = Boolean(resolvedProfile?.isRegistered || conversation.isRegisteredClient)
  const savedLocations = resolvedProfile?.locations || []
  const primaryLocation =
    (selectedLocationId ? savedLocations.find(l => l.id === selectedLocationId) : null) ||
    savedLocations.find(l => l.isFavorite) ||
    savedLocations[0] ||
    null

  const effectiveDeliveryType: '' | 'delivery' | 'pickup' =
    deliveryType || (primaryLocation || customLocationInput.trim() || conversation.detectedLocationLink ? 'delivery' : '')
  const isPickup = effectiveDeliveryType === 'pickup'

  const isProductsComplete = draftItems.length > 0
  const isImmediateTiming = timingType === 'immediate'
  const isTimingComplete =
    timingType === 'immediate' ||
    (timingType === 'scheduled' && Boolean(scheduledDate && scheduledTime))
  const isDeliveryComplete =
    isPickup || Boolean(primaryLocation || customLocationInput.trim() || conversation.detectedLocationLink)
  const parsedCashAmount = parseFloat(cashAmountInput) || 0
  const parsedTransferAmount = parseFloat(transferAmountInput) || 0
  const isPaymentComplete =
    paymentMethod === 'cash' ||
    paymentMethod === 'transfer' ||
    (paymentMethod === 'mixed' && parsedCashAmount > 0 && parsedTransferAmount > 0)

  const timeLabel = formatWhatsAppTime(conversation.timestampMillis || Date.now())
  const cleanPhone = (resolvedProfile?.clientPhone || conversation.rawPhone || conversation.phone || '').replace(/\D/g, '')
  const isUnregisteredClient = !isRegisteredClient && (resolvedProfile !== undefined || cleanPhone.length < 9)
  const messages =
    conversation.recentMessages && conversation.recentMessages.length > 0
      ? conversation.recentMessages
      : conversation.lastMessage
        ? [conversation.lastMessage]
        : []

  const handlePasteMessageToActiveField = (rawMessage: string) => {
    const text = rawMessage.trim()
    if (!text) return
    const target =
      focusedFieldRef.current ||
      (isEditingClientName
        ? 'clientName'
        : activeTab === 'products'
          ? 'productSearch'
          : activeTab === 'delivery' && effectiveDeliveryType !== 'pickup' && !primaryLocation
            ? 'customLocation'
            : null)

    if (target === 'clientName') {
      setNewClientName(text)
      clientNameInputRef.current?.focus()
    } else if (target === 'productSearch') {
      setProductSearch(text)
      productSearchInputRef.current?.focus()
    } else if (target === 'customLocation') {
      setCustomLocationInput(text)
      if (deliveryType !== 'delivery') setDeliveryType('delivery')
      customLocationInputRef.current?.focus()
    } else if (target === 'cashAmount' || target === 'transferAmount') {
      const numMatch = text.replace(',', '.').match(/\d+(?:\.\d{1,2})?/)
      if (numMatch) {
        if (target === 'cashAmount') {
          setCashAmountInput(numMatch[0])
          cashAmountInputRef.current?.focus()
        } else {
          setTransferAmountInput(numMatch[0])
          transferAmountInputRef.current?.focus()
        }
      }
    }
  }

  const filteredProducts = useMemo(() => {
    const available = products.filter(p => p.isAvailable !== false)
    const trimmed = productSearch.trim()
    if (!trimmed) return available.slice(0, 8)
    return available
      .map(p => ({ product: p, score: scoreProductSmartMatch(p, trimmed) }))
      .filter(entry => entry.score >= 22)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(entry => entry.product)
  }, [products, productSearch])

  const handleSaveNewClient = async () => {
    const trimmedName = newClientName.trim()
    const rawPhoneToSave = (resolvedProfile?.clientPhone || conversation.phone || conversation.rawPhone || '').trim()
    if (!trimmedName || !rawPhoneToSave || savingNewClient) return

    setSavingNewClient(true)
    try {
      const newClientId = await createClient({
        celular: rawPhoneToSave,
        nombres: trimmedName,
      })
      if (businessId && conversation.docId) {
        updateDoc(doc(db, 'businesses', businessId, 'whatsappPending', conversation.docId), {
          fuddiClientId: newClientId,
          fuddiClientName: trimmedName,
          effectiveName: trimmedName,
          isRegisteredClient: true,
        }).catch(() => {})
      }
      setResolvedProfile({
        clientId: newClientId,
        clientName: trimmedName,
        clientPhone: rawPhoneToSave,
        isRegistered: true,
        locations: savedLocations,
      })
      setNewClientName('')
      setIsEditingClientName(false)
    } catch (err) {
      console.error('[WhatsAppChatView] Error saving new client:', err)
    } finally {
      setSavingNewClient(false)
    }
  }

  const handleAddDraftProduct = (product: Product, variantObj?: any) => {
    const variantName = variantObj?.name as string | undefined
    const priceSource = variantObj || product
    const unitPrice = getManualOrderStorePrice(priceSource)
    const meta = getPriceMetadata(priceSource)
    const fullName = variantName ? `${product.name} - ${variantName}` : product.name

    setDraftItems(prev => {
      const idx = prev.findIndex(
        item => item.productId === product.id && (item.variant || '') === (variantName || '')
      )
      if (idx >= 0) {
        return prev.map((item, i) => (i === idx ? { ...item, quantity: item.quantity + 1 } : item))
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: fullName,
          productName: product.name,
          variant: variantName,
          variantName,
          price: unitPrice,
          quantity: 1,
          image: product.image,
          basePrice: meta.basePrice,
          commission: meta.commission,
          commissionType: meta.commissionType,
          storeReceives: meta.storeReceives,
          ingredients: variantObj?.ingredients || product.ingredients,
        },
      ]
    })
  }

  const handleUpdateDraftItemQty = (index: number, delta: number) => {
    setDraftItems(prev =>
      prev
        .map((item, i) => (i === index ? { ...item, quantity: item.quantity + delta } : item))
        .filter(item => item.quantity > 0)
    )
  }

  const draftSubtotal = useMemo(
    () => draftItems.reduce((acc, item) => acc + item.price * item.quantity, 0),
    [draftItems]
  )

  const sentOrderBubbles = useMemo(() => {
    const byId = new Map<string, any>()
    for (const o of clientOrders) {
      if (o?.id) byId.set(String(o.id), o)
    }
    if (activeOrder?.id && !byId.has(String(activeOrder.id))) {
      byId.set(String(activeOrder.id), activeOrder)
    }

    const list = Array.from(byId.values())
      .filter((o) => String(o.status || '').toLowerCase() !== 'cancelled')
      .map((o) => {
        const rawTs = o.createdAt
        let createdMs = 0
        if (rawTs instanceof Date) createdMs = rawTs.getTime()
        else if (rawTs && typeof rawTs.toDate === 'function') createdMs = rawTs.toDate().getTime()
        else if (rawTs && typeof rawTs.seconds === 'number') createdMs = rawTs.seconds * 1000
        else if (typeof rawTs === 'number') createdMs = rawTs
        else if (typeof rawTs === 'string') createdMs = new Date(rawTs).getTime() || 0
        return { order: o, createdMs }
      })
      .sort((a, b) => a.createdMs - b.createdMs)

    // Si hay una orden confirmada en la conversación que no está en clientOrders, mostrar resumen de respaldo
    if (
      conversation.confirmedOrderId &&
      !byId.has(String(conversation.confirmedOrderId)) &&
      (conversation.confirmedOrderSummary || typeof conversation.confirmedOrderTotal === 'number')
    ) {
      list.push({
        order: {
          id: conversation.confirmedOrderId,
          status: 'confirmed',
          total: conversation.confirmedOrderTotal,
          _fallbackSummary: conversation.confirmedOrderSummary,
        },
        createdMs: conversation.confirmedAtMillis || conversation.resolvedAtMillis || Date.now(),
      })
    }

    return list
  }, [clientOrders, activeOrder, conversation])

  const timelineEntries = useMemo(() => {
    type TimelineEntry =
      | { kind: 'message'; key: string; timestampMillis: number; msg: any }
      | { kind: 'order'; key: string; timestampMillis: number; order: any; createdMs: number }

    const entries: TimelineEntry[] = []

    if (Array.isArray(conversation.chatHistory) && conversation.chatHistory.length > 0) {
      conversation.chatHistory.forEach((msg, idx) => {
        entries.push({
          kind: 'message',
          key: msg.id || `${msg.fromMe ? 'me' : 'in'}-${idx}`,
          timestampMillis: Number(msg.timestampMillis || 0),
          msg,
        })
      })
    } else {
      const baseTs = Math.max(1, (conversation.timestampMillis || Date.now()) - messages.length * 1000)
      messages.forEach((txt, idx) => {
        entries.push({
          kind: 'message',
          key: `fallback-in-${idx}`,
          timestampMillis: baseTs + idx * 1000,
          msg: { id: `fallback-in-${idx}`, text: txt, fromMe: false, timestampMillis: baseTs + idx * 1000 },
        })
      })
      if (Array.isArray(conversation.sentReplies)) {
        conversation.sentReplies.forEach((reply, idx) => {
          entries.push({
            kind: 'message',
            key: reply.id || `fallback-reply-${idx}`,
            timestampMillis: Number(reply.timestampMillis || 0),
            msg: {
              id: reply.id || `fallback-reply-${idx}`,
              text: reply.text,
              fromMe: true,
              timestampMillis: Number(reply.timestampMillis || 0),
            },
          })
        })
      }
    }

    sentOrderBubbles.forEach(({ order, createdMs }) => {
      entries.push({
        kind: 'order',
        key: `sent-order-${order.id}`,
        timestampMillis: createdMs || Date.now(),
        order,
        createdMs,
      })
    })

    return entries.sort((a, b) => a.timestampMillis - b.timestampMillis)
  }, [conversation.chatHistory, conversation.sentReplies, conversation.timestampMillis, messages, sentOrderBubbles])

  const getOrderStatusLabel = (status?: string): string => {
    switch (String(status || '').toLowerCase()) {
      case 'borrador': return 'Borrador'
      case 'pending': return 'Pendiente'
      case 'confirmed': return 'Confirmado'
      case 'preparing': return 'Preparando'
      case 'ready': return 'Listo'
      case 'on_way': return 'En camino'
      case 'delivered': return 'Entregado'
      default: return 'Pedido creado'
    }
  }

  const enrichedConversation: PendingWhatsAppConversation = resolvedProfile
    ? {
        ...conversation,
        fuddiClientId: resolvedProfile.clientId || conversation.fuddiClientId,
        fuddiClientName: resolvedProfile.clientName || conversation.fuddiClientName,
        effectiveName: resolvedProfile.clientName || conversation.effectiveName,
        phone: resolvedProfile.clientPhone || conversation.phone,
        fuddiClientEmail: resolvedProfile.clientEmail || conversation.fuddiClientEmail,
        fuddiClientNotes: resolvedProfile.clientNotes || conversation.fuddiClientNotes,
        isRegisteredClient,
      }
    : conversation

  const buildDraft = (): WhatsAppPreorderDraft => ({
    items: draftItems.length > 0 ? draftItems : undefined,
    timingType: timingType || undefined,
    scheduledDate: timingType === 'scheduled' ? scheduledDate : undefined,
    scheduledTime: timingType === 'scheduled' ? scheduledTime : undefined,
    deliveryType: effectiveDeliveryType || undefined,
    selectedLocation: effectiveDeliveryType === 'delivery' ? primaryLocation : null,
    customLocationInput:
      effectiveDeliveryType === 'delivery' && !primaryLocation
        ? (customLocationInput.trim() || conversation.detectedLocationLink || undefined)
        : undefined,
    paymentMethod: paymentMethod || undefined,
    cashAmount: paymentMethod === 'mixed' ? parsedCashAmount : undefined,
    transferAmount: paymentMethod === 'mixed' ? parsedTransferAmount : undefined,
  })

  const stepIndicators: Array<{
    key: PreorderTabKey
    completed: boolean
    completedClass: string
    icon: React.ReactNode
    label: string
    title: string
  }> = [
    {
      key: 'products',
      completed: isProductsComplete,
      completedClass: 'bg-emerald-100 text-emerald-600',
      icon: <i className="bi bi-bag-fill"></i>,
      label: 'Productos',
      title: isProductsComplete
        ? `${draftItems.reduce((s, i) => s + i.quantity, 0)} producto(s)`
        : 'Agregar productos',
    },
    {
      key: 'timing',
      completed: isTimingComplete,
      completedClass: isImmediateTiming
        ? 'bg-amber-100 text-amber-500'
        : 'bg-emerald-100 text-emerald-600',
      icon: <i className={`bi ${isImmediateTiming ? 'bi-lightning-charge-fill' : 'bi-clock-fill'}`}></i>,
      label: 'Horario',
      title: isTimingComplete
        ? timingType === 'scheduled'
          ? `Programado: ${scheduledDate} ${scheduledTime}`
          : 'Entrega inmediata'
        : 'Elegir horario',
    },
    {
      key: 'delivery',
      completed: isDeliveryComplete,
      completedClass: 'bg-emerald-100 text-emerald-600',
      icon: isPickup ? <i className="bi bi-shop"></i> : <Motorbike className="w-3.5 h-3.5" strokeWidth={2.2} />,
      label: 'Entrega',
      title: isPickup
        ? 'Recoger en tienda'
        : primaryLocation
          ? `Dirección: ${primaryLocation.referencia || primaryLocation.sector || 'Guardada'}`
          : 'Elegir entrega',
    },
    {
      key: 'payment',
      completed: isPaymentComplete,
      completedClass: 'bg-emerald-100 text-emerald-600',
      icon: <i className={`bi ${paymentMethod === 'cash' ? 'bi-cash-coin' : 'bi-credit-card-fill'}`}></i>,
      label: 'Pago',
      title: isPaymentComplete ? 'Método de pago listo' : 'Elegir método de pago',
    },
  ]

  return (
    <div className="fixed inset-0 z-30 h-[100dvh] w-full flex flex-col bg-slate-50 overflow-hidden animate-in fade-in slide-in-from-right-3 duration-150">
      {/* Top Header (siempre fijo arriba) */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-6 py-2.5 shrink-0">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              style={{ minHeight: 0 }}
              onClick={onBack}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
              title="Volver"
            >
              <i className="bi bi-arrow-left text-base"></i>
            </button>

            <i className="bi bi-whatsapp text-green-600 shrink-0 text-base"></i>

            {isEditingClientName ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <input
                  ref={clientNameInputRef}
                  type="text"
                  value={newClientName}
                  onFocus={() => { focusedFieldRef.current = 'clientName' }}
                  onChange={(e) => setNewClientName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleSaveNewClient()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setIsEditingClientName(false)
                      setNewClientName('')
                    }
                  }}
                  placeholder="Nombre del cliente..."
                  className="flex-1 min-w-0 h-8 px-2.5 text-xs font-semibold text-gray-900 bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                />
                <button
                  type="button"
                  style={{ minHeight: 0, minWidth: 0 }}
                  disabled={!newClientName.trim() || savingNewClient}
                  onClick={() => void handleSaveNewClient()}
                  className="w-8 h-8 min-h-0 min-w-0 p-0 shrink-0 rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white inline-flex items-center justify-center"
                >
                  {savingNewClient ? (
                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
                  ) : (
                    <i className="bi bi-check2 text-sm"></i>
                  )}
                </button>
                <button
                  type="button"
                  style={{ minHeight: 0, minWidth: 0 }}
                  onClick={() => {
                    setIsEditingClientName(false)
                    setNewClientName('')
                  }}
                  className="w-8 h-8 min-h-0 min-w-0 p-0 shrink-0 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-500 inline-flex items-center justify-center"
                >
                  <i className="bi bi-x text-sm"></i>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <h2 className="text-sm sm:text-base font-black text-gray-900 tracking-tight truncate">
                  {displayName}
                </h2>
                {isUnregisteredClient && (
                  <button
                    type="button"
                    style={{ minHeight: 0 }}
                    onClick={() => {
                      setIsEditingClientName(true)
                      setTimeout(() => clientNameInputRef.current?.focus(), 30)
                    }}
                    className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 cursor-pointer"
                  >
                    <i className="bi bi-person-plus-fill"></i>
                    Nuevo
                  </button>
                )}
                {activeOrder && (
                  <button
                    type="button"
                    style={{ minHeight: 0 }}
                    onClick={() => onInspectOrder?.(activeOrder)}
                    className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 cursor-pointer"
                  >
                    <i className="bi bi-bag-check-fill"></i>
                    Orden activa
                  </button>
                )}
              </div>
            )}
          </div>

          {!isEditingClientName && (
            <div className="shrink-0 flex items-center gap-1.5">
              {stepIndicators.map(step => {
                const isActive = activeTab === step.key
                return (
                  <button
                    key={step.key}
                    type="button"
                    style={{ minHeight: 0, minWidth: 0 }}
                    onClick={() => setActiveTab(prev => (prev === step.key ? null : step.key))}
                    title={step.title}
                    className={`w-7 h-7 min-h-0 min-w-0 p-0 shrink-0 rounded-full inline-flex items-center justify-center text-xs leading-none transition-all cursor-pointer ${
                      step.completed
                        ? step.completedClass
                        : 'bg-gray-100 text-gray-400 hover:bg-gray-200/80'
                    } ${isActive ? 'ring-2 ring-blue-500/80 ring-offset-1' : 'hover:ring-2 hover:ring-gray-300'}`}
                  >
                    {step.icon}
                  </button>
                )
              })}
              {(cleanPhone || onCloseConversation) && (
                <div ref={headerMenuRef} className="relative">
                  <button
                    type="button"
                    style={{ minHeight: 0, minWidth: 0 }}
                    onClick={() => setShowHeaderMenu((prev) => !prev)}
                    title="Más opciones"
                    className="w-7 h-7 min-h-0 min-w-0 p-0 shrink-0 rounded-full inline-flex items-center justify-center text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <i className="bi bi-three-dots-vertical"></i>
                  </button>
                  {showHeaderMenu && (
                    <div className="absolute right-0 mt-1.5 w-44 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 px-1.5 z-40 animate-in fade-in zoom-in-95 duration-100 space-y-1">
                      {cleanPhone && (
                        <a
                          href={`https://wa.me/${cleanPhone}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setShowHeaderMenu(false)}
                          className="w-full h-8 px-2.5 bg-white hover:bg-green-50 text-green-700 text-xs font-bold rounded-lg transition-colors inline-flex items-center gap-2"
                        >
                          <i className="bi bi-whatsapp text-sm"></i>
                          Chat en WhatsApp
                        </a>
                      )}
                      {onCloseConversation && (
                        <button
                          type="button"
                          style={{ minHeight: 0 }}
                          onClick={() => {
                            setShowHeaderMenu(false)
                            onCloseConversation(conversation.docId)
                            onBack()
                          }}
                          className="w-full h-8 px-2.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-lg transition-colors inline-flex items-center gap-2 cursor-pointer"
                        >
                          <i className="bi bi-archive text-sm"></i>
                          Archivar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Top Scrollable Area: Client Messages (única zona con scroll) */}
      <div
        ref={messagesScrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-6 py-2.5"
      >
        <div className="max-w-3xl mx-auto flex flex-col items-start gap-1.5">
          {timelineEntries.length > 0 ? (
            timelineEntries.map((entry) => {
              if (entry.kind === 'order') {
                const { order, createdMs } = entry
                const items = Array.isArray(order.items) ? order.items : []
                const isPickupOrder = order.delivery?.type === 'pickup'
                const orderTime = formatWhatsAppTime(createdMs || Date.now())
                const canInspect = Boolean(onInspectOrder && !order._fallbackSummary)
                return (
                  <div
                    key={entry.key}
                    onClick={canInspect ? () => onInspectOrder?.(order) : undefined}
                    title={canInspect ? 'Clic para ver o editar pedido' : undefined}
                    className={`self-end max-w-[88%] sm:max-w-[75%] bg-[#dcf8c6] border border-emerald-200/90 rounded-xl rounded-tr-xs px-3 py-2 text-xs text-slate-800 shadow-2xs space-y-1.5 ${
                      canInspect ? 'cursor-pointer hover:bg-[#d2f5b8] transition-colors' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-black text-emerald-900 inline-flex items-center gap-1">
                        <i className="bi bi-bag-check-fill text-emerald-700"></i>
                        Pedido creado
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/80 text-emerald-800 border border-emerald-200">
                        {getOrderStatusLabel(order.status)}
                      </span>
                    </div>

                    {items.length > 0 ? (
                      <div className="space-y-0.5 text-[11px] text-slate-800">
                        {items.map((it: any, i: number) => (
                          <p key={i} className="leading-snug">
                            <span className="font-bold">{it.quantity || 1}x</span>{' '}
                            {it.productName || it.name || 'Producto'}
                            {(it.variant || it.variantName) ? ` (${it.variant || it.variantName})` : ''}
                          </p>
                        ))}
                      </div>
                    ) : order._fallbackSummary ? (
                      <p className="text-[11px] text-slate-800 leading-snug">{order._fallbackSummary}</p>
                    ) : null}

                    {order.delivery && (
                      <p className="text-[11px] text-emerald-900/80 flex items-center gap-1">
                        <i className={`bi ${isPickupOrder ? 'bi-shop' : 'bi-geo-alt-fill'} shrink-0`}></i>
                        <span className="truncate">
                          {isPickupOrder
                            ? 'Recoger en tienda'
                            : (order.delivery.references || order.delivery.address || 'Delivery')}
                        </span>
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-3 pt-0.5 border-t border-emerald-200/70">
                      {typeof order.total === 'number' ? (
                        <span className="font-black text-emerald-950 text-xs">
                          Total: ${order.total.toFixed(2)}
                        </span>
                      ) : (
                        <span></span>
                      )}
                      <span className="text-[10px] text-emerald-800/80 inline-flex items-center gap-1 ml-auto">
                        {orderTime}
                        <i className="bi bi-check2-all text-sky-600 text-xs"></i>
                      </span>
                    </div>
                  </div>
                )
              }

              const msg = entry.msg
              const locationPreview = !msg.fromMe ? extractLocationPreviewFromMessage(msg.text) : null
              const isImageOnlyMsg = Boolean(msg.mediaUrl && msg.mediaType === 'image')
              const cleanedImageCaption = isImageOnlyMsg
                ? String(msg.text || '')
                    .replace(/^📷\s*/, '')
                    .trim()
                : ''
              const hasRealImageCaption =
                Boolean(cleanedImageCaption) &&
                !/^imagen enviada$/i.test(cleanedImageCaption) &&
                !/^envi[oó] una foto\.?$/i.test(cleanedImageCaption)

              const msgIdStr = String(msg?.id || '')
              const canReactToMsg =
                Boolean(msgIdStr) &&
                !msgIdStr.startsWith('fallback-') &&
                !msgIdStr.startsWith('in_') &&
                (Boolean(msg?.waMsgId) || !msgIdStr.startsWith('web_'))
              const baseReactions: Array<{ emoji: string; fromMe: boolean }> = Array.isArray(msg?.reactions)
                ? msg.reactions
                : []
              const effectiveReactions =
                msgIdStr && optimisticReactions[msgIdStr] !== undefined
                  ? [
                      ...baseReactions.filter((r) => !r?.fromMe),
                      ...(optimisticReactions[msgIdStr]
                        ? [{ emoji: optimisticReactions[msgIdStr] as string, fromMe: true }]
                        : []),
                    ]
                  : baseReactions
              const myReactionEmoji = effectiveReactions.find((r) => r?.fromMe)?.emoji || null
              const isReactionPickerOpen = openReactionMsgKey === entry.key

              const bubbleNode = msg.fromMe ? (
                <div className="bg-[#dcf8c6] border border-emerald-200/90 rounded-xl rounded-tr-xs px-3 py-1.5 text-xs text-slate-800 shadow-2xs space-y-1.5">
                  {msg.linkPreview && (msg.linkPreview.title || msg.linkPreview.image) && (
                    <a
                      href={msg.linkPreview.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-stretch gap-2 rounded-lg overflow-hidden bg-emerald-900/[0.06] hover:bg-emerald-900/[0.1] border border-emerald-200/80 transition-colors"
                    >
                      {msg.linkPreview.image && (
                        <div className="w-16 shrink-0 bg-slate-200 overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={msg.linkPreview.image}
                            alt={msg.linkPreview.title || 'Vista previa'}
                            onLoad={() => {
                              if (isInitialScrollPendingRef.current) {
                                scrollMessagesToBottom(false)
                              }
                            }}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <div className="min-w-0 flex-1 py-1.5 pr-2 pl-1 space-y-0.5">
                        {msg.linkPreview.title && (
                          <p className="text-[11px] font-bold text-slate-900 line-clamp-1 leading-tight">
                            {msg.linkPreview.title}
                          </p>
                        )}
                        {msg.linkPreview.description && (
                          <p className="text-[10px] text-slate-600 line-clamp-2 leading-snug">
                            {msg.linkPreview.description}
                          </p>
                        )}
                        {msg.linkPreview.siteName && (
                          <p className="text-[10px] text-emerald-800/75 truncate">
                            {msg.linkPreview.siteName}
                          </p>
                        )}
                      </div>
                    </a>
                  )}
                  <p className="whitespace-pre-wrap break-words leading-snug">{msg.text}</p>
                  <div className="flex items-center justify-end gap-1 pt-0.5 text-[10px] text-emerald-800/80">
                    <span>{formatWhatsAppTime(msg.timestampMillis)}</span>
                    <i className="bi bi-check2-all text-sky-600 text-xs"></i>
                  </div>
                </div>
              ) : locationPreview ? (
                <div className="w-[250px] sm:w-[270px] bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-2xs">
                  <a
                    href={locationPreview.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block group"
                    title="Clic para abrir en Google Maps"
                  >
                    <div className="relative w-full h-[136px] bg-slate-100 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={locationPreview.staticMapUrl}
                        alt={locationPreview.label}
                        onLoad={() => {
                          if (isInitialScrollPendingRef.current) {
                            scrollMessagesToBottom(false)
                          }
                        }}
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                      />
                    </div>
                    <div className="px-2.5 py-2 flex items-center justify-between gap-2 bg-white group-hover:bg-blue-50/40 transition-colors">
                      <span className="text-xs font-bold text-slate-800 truncate inline-flex items-center gap-1.5">
                        <i className="bi bi-geo-alt-fill text-rose-500 shrink-0"></i>
                        <span className="truncate">{locationPreview.label}</span>
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {formatWhatsAppTime(msg.timestampMillis)}
                      </span>
                    </div>
                  </a>
                </div>
              ) : isImageOnlyMsg ? (
                <div className="w-[240px] sm:w-[270px] bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-2xs">
                  <button
                    type="button"
                    style={{ minHeight: 0 }}
                    onClick={() =>
                      setPreviewImageModal({
                        url: msg.mediaUrl,
                        caption: hasRealImageCaption ? cleanedImageCaption : undefined,
                      })
                    }
                    className="relative block w-full bg-slate-100 cursor-zoom-in text-left"
                    title="Clic para ampliar imagen"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={msg.mediaUrl}
                      alt={hasRealImageCaption ? cleanedImageCaption : 'Imagen recibida'}
                      onLoad={() => {
                        if (isInitialScrollPendingRef.current) {
                          scrollMessagesToBottom(false)
                        }
                      }}
                      className="w-full max-h-72 object-cover block"
                    />
                    {!hasRealImageCaption && msg.timestampMillis ? (
                      <span className="absolute bottom-1.5 right-2 px-1.5 py-0.5 rounded-md bg-black/55 text-[10px] font-medium text-white">
                        {formatWhatsAppTime(msg.timestampMillis)}
                      </span>
                    ) : null}
                  </button>
                  {hasRealImageCaption && (
                    <button
                      type="button"
                      style={{ minHeight: 0 }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handlePasteMessageToActiveField(cleanedImageCaption)}
                      title="Toca para pegar en el campo activo"
                      className="w-full text-left px-2.5 py-1.5 text-xs leading-snug text-slate-800 whitespace-pre-wrap break-words hover:bg-blue-50/50 transition-colors cursor-pointer"
                    >
                      <span className="block">{cleanedImageCaption}</span>
                      {msg.timestampMillis ? (
                        <span className="flex items-center justify-end text-[10px] text-slate-400 pt-0.5">
                          {formatWhatsAppTime(msg.timestampMillis)}
                        </span>
                      ) : null}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  style={{ minHeight: 0 }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handlePasteMessageToActiveField(msg.text)}
                  title="Toca para pegar en el campo activo"
                  className="text-left bg-white hover:bg-blue-50/50 border border-slate-200/90 hover:border-blue-300 rounded-xl px-2.5 py-1.5 text-xs leading-snug text-slate-800 whitespace-pre-wrap break-words transition-colors cursor-pointer shadow-2xs space-y-1.5"
                >
                  {msg.mediaUrl && (msg.mediaType === 'image' || msg.mediaType === 'order') && (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setPreviewImageModal({ url: msg.mediaUrl, caption: msg.text || undefined })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          setPreviewImageModal({ url: msg.mediaUrl, caption: msg.text || undefined })
                        }
                      }}
                      className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-100 max-w-[240px] cursor-zoom-in"
                      title="Clic para ampliar imagen"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={msg.mediaUrl}
                        alt={msg.text || 'Imagen recibida'}
                        onLoad={() => {
                          if (isInitialScrollPendingRef.current) {
                            scrollMessagesToBottom(false)
                          }
                        }}
                        className="w-full max-h-56 object-cover"
                      />
                    </div>
                  )}
                  {msg.mediaUrl && msg.mediaType === 'document' && (
                    <a
                      href={msg.mediaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-semibold text-xs"
                    >
                      <i className="bi bi-file-earmark-arrow-down-fill"></i>
                      <span className="truncate max-w-[200px]">
                        {msg.fileName || 'Abrir documento'}
                      </span>
                    </a>
                  )}
                  {msg.mediaUrl && msg.mediaType === 'audio' && (
                    <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                      <audio controls src={msg.mediaUrl} className="h-8 max-w-[230px]" />
                    </div>
                  )}
                  <span className="block">{msg.text}</span>
                  {msg.timestampMillis ? (
                    <span className="flex items-center justify-end text-[10px] text-slate-400 pt-0.5">
                      {formatWhatsAppTime(msg.timestampMillis)}
                    </span>
                  ) : null}
                </button>
              )

              return (
                <div
                  key={entry.key}
                  className={`group/msg relative flex flex-col max-w-[92%] sm:max-w-[80%] ${
                    msg.fromMe ? 'self-end items-end' : 'self-start items-start'
                  }`}
                >
                  <div
                    className={`relative flex items-center gap-1 ${
                      msg.fromMe ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    {bubbleNode}

                    {canReactToMsg && (
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          style={{ minHeight: 0, minWidth: 0 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenReactionMsgKey((prev) =>
                              prev === entry.key ? null : entry.key
                            )
                          }}
                          title="Reaccionar"
                          className={`w-6 h-6 rounded-full bg-white/90 hover:bg-slate-100 border border-slate-200/80 text-slate-400 hover:text-slate-700 shadow-2xs inline-flex items-center justify-center transition-opacity cursor-pointer ${
                            isReactionPickerOpen
                              ? 'opacity-100'
                              : 'opacity-40 sm:opacity-0 sm:group-hover/msg:opacity-100'
                          }`}
                        >
                          <i className="bi bi-emoji-smile text-[11px]"></i>
                        </button>

                        {isReactionPickerOpen && (
                          <div
                            className={`absolute bottom-full mb-1.5 ${
                              msg.fromMe ? 'right-0' : 'left-0'
                            } flex items-center gap-0.5 bg-white border border-slate-200 rounded-full shadow-lg px-1.5 py-1 z-30 animate-in fade-in zoom-in-95 duration-100`}
                          >
                            {QUICK_REACTION_EMOJIS.map((em) => (
                              <button
                                key={em}
                                type="button"
                                style={{ minHeight: 0, minWidth: 0 }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void handleReactToMessage(msg, em)
                                }}
                                className={`w-7 h-7 rounded-full hover:bg-slate-100 hover:scale-110 transition-transform inline-flex items-center justify-center text-sm cursor-pointer ${
                                  myReactionEmoji === em ? 'bg-emerald-50 ring-1 ring-emerald-300' : ''
                                }`}
                                title={myReactionEmoji === em ? 'Quitar reacción' : `Reaccionar con ${em}`}
                              >
                                {em}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {effectiveReactions.length > 0 && (
                    <div
                      className={`flex items-center gap-1 -mt-1.5 z-10 ${
                        msg.fromMe ? 'mr-2' : 'ml-2'
                      }`}
                    >
                      {effectiveReactions.map((r, rIdx) => (
                        <button
                          key={`${r.emoji}-${r.fromMe ? 'me' : 'in'}-${rIdx}`}
                          type="button"
                          style={{ minHeight: 0, minWidth: 0 }}
                          onClick={() => {
                            if (r.fromMe && canReactToMsg) {
                              void handleReactToMessage(msg, r.emoji)
                            }
                          }}
                          title={r.fromMe ? 'Toca para quitar tu reacción' : 'Reacción del cliente'}
                          className={`px-1.5 py-0.5 rounded-full bg-white border border-slate-200 shadow-xs text-xs leading-none inline-flex items-center justify-center ${
                            r.fromMe && canReactToMsg ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default'
                          }`}
                        >
                          {r.emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            <p className="w-full text-xs text-slate-400 bg-white rounded-xl border border-slate-200 px-3 py-4 text-center">
              Sin mensajes registrados
            </p>
          )}

          {(conversation.pendingReply?.status === 'pending' ||
            (optimisticReply &&
              !conversation.chatHistory?.some((m) => m.id === optimisticReply.id) &&
              !conversation.sentReplies?.some((r) => r.id === optimisticReply.id))) && (
            <div className="self-end max-w-[88%] sm:max-w-[75%] bg-[#dcf8c6]/80 border border-emerald-200 rounded-xl rounded-tr-xs px-3 py-1.5 text-xs text-slate-800 shadow-2xs">
              <p className="whitespace-pre-wrap break-words leading-snug">
                {conversation.pendingReply?.text || optimisticReply?.text}
              </p>
              <div className="flex items-center justify-end gap-1 pt-0.5 text-[10px] text-emerald-800">
                <span>Enviando...</span>
                <i className="bi bi-clock text-[10px]"></i>
              </div>
            </div>
          )}

          {conversation.pendingReply?.status === 'failed' && (
            <div className="self-end max-w-[88%] sm:max-w-[75%] bg-amber-50 border border-amber-200 rounded-xl rounded-tr-xs px-3 py-2 text-xs text-amber-900 shadow-2xs space-y-1">
              <p className="whitespace-pre-wrap break-words leading-snug">{conversation.pendingReply.text}</p>
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-200/70">
                <span className="text-[10px] font-semibold text-amber-800">
                  La notificación ya no estaba activa en el teléfono
                </span>
                {cleanPhone && (
                  <a
                    href={`https://wa.me/${cleanPhone}?text=${encodeURIComponent(conversation.pendingReply.text)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-green-700 hover:underline"
                  >
                    <i className="bi bi-whatsapp"></i>
                    Enviar por WhatsApp
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Footer: Active Form + Actions (siempre fijo abajo y visible) */}
      <div className="relative z-40 bg-white border-t border-slate-200 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] shrink-0 overflow-visible">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 py-2.5 space-y-2.5">
          {activeTab && (
            <div className="max-h-[45dvh] overflow-y-auto overscroll-contain space-y-2.5">
          {/* Active Preorder Form Drawer in Footer */}
          {activeTab === 'products' && (
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-2.5 space-y-2 animate-in slide-in-from-bottom-2 duration-150">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700 flex items-center gap-1.5">
                  <i className="bi bi-bag-fill"></i>
                  Productos
                </p>
                {draftItems.length > 0 && (
                  <span className="text-xs font-black text-gray-900">${draftSubtotal.toFixed(2)}</span>
                )}
              </div>

              {draftItems.length > 0 && (
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {draftItems.map((item, idx) => (
                    <div
                      key={`${item.productId}-${item.variant || ''}`}
                      className="flex items-center justify-between gap-2 bg-emerald-50/80 border border-emerald-100 rounded-lg px-2 py-1 text-xs"
                    >
                      <span className="font-semibold text-gray-800 truncate flex-1">{item.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          style={{ minHeight: 0, minWidth: 0 }}
                          onClick={() => handleUpdateDraftItemQty(idx, -1)}
                          className="w-6 h-6 min-h-0 min-w-0 rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold"
                        >
                          -
                        </button>
                        <span className="w-5 text-center font-bold text-gray-900">{item.quantity}</span>
                        <button
                          type="button"
                          style={{ minHeight: 0, minWidth: 0 }}
                          onClick={() => handleUpdateDraftItemQty(idx, 1)}
                          className="w-6 h-6 min-h-0 min-w-0 rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <input
                ref={productSearchInputRef}
                type="text"
                value={productSearch}
                onFocus={() => { focusedFieldRef.current = 'productSearch' }}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Buscar producto (o toca un mensaje arriba)..."
                className="w-full px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              />

              {filteredProducts.length > 0 ? (
                <div className="max-h-36 overflow-y-auto divide-y divide-gray-100 bg-white rounded-lg border border-gray-100 px-2">
                  {filteredProducts.map(prod => {
                    const hasVariants = Array.isArray(prod.variants) && prod.variants.length > 0
                    if (hasVariants) {
                      return (
                        <div key={prod.id} className="py-1.5 space-y-1">
                          <p className="text-xs font-bold text-gray-800">{prod.name}</p>
                          <div className="flex flex-wrap gap-1">
                            {prod.variants!.map(v => (
                              <button
                                key={v.name}
                                type="button"
                                style={{ minHeight: 0 }}
                                onClick={() => handleAddDraftProduct(prod, v)}
                                className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 hover:bg-emerald-100 hover:text-emerald-700 text-gray-700 transition-colors"
                              >
                                + {v.name} (${getManualOrderStorePrice(v).toFixed(2)})
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    }
                    return (
                      <button
                        key={prod.id}
                        type="button"
                        style={{ minHeight: 0 }}
                        onClick={() => handleAddDraftProduct(prod)}
                        className="w-full py-1.5 text-left hover:bg-emerald-50/60 rounded flex items-center justify-between gap-2 text-xs transition-colors"
                      >
                        <span className="font-medium text-gray-800 truncate">{prod.name}</span>
                        <span className="shrink-0 font-bold text-emerald-700">
                          + ${getManualOrderStorePrice(prod).toFixed(2)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center py-1">No se encontraron productos</p>
              )}
            </div>
          )}

          {activeTab === 'timing' && (
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-2.5 space-y-2 animate-in slide-in-from-bottom-2 duration-150">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-1.5">
                <i className="bi bi-clock-fill text-amber-500"></i>
                Horario de entrega
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  style={{ minHeight: 0 }}
                  onClick={() => setTimingType('immediate')}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    timingType === 'immediate'
                      ? 'bg-amber-50 border-amber-300 text-amber-700 ring-1 ring-amber-300'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <i className="bi bi-lightning-charge-fill text-amber-500"></i>
                  Inmediato
                </button>
                <button
                  type="button"
                  style={{ minHeight: 0 }}
                  onClick={() => setTimingType('scheduled')}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    timingType === 'scheduled'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-1 ring-emerald-300'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <i className="bi bi-clock-fill text-emerald-600"></i>
                  Programado
                </button>
              </div>
              {timingType === 'scheduled' && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === 'delivery' && (
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-2.5 space-y-2 animate-in slide-in-from-bottom-2 duration-150">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  style={{ minHeight: 0 }}
                  onClick={() => setDeliveryType('delivery')}
                  className={`py-1.5 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    effectiveDeliveryType !== 'pickup'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Motorbike className="w-4 h-4" strokeWidth={2.2} />
                  Delivery
                </button>
                <button
                  type="button"
                  style={{ minHeight: 0 }}
                  onClick={() => setDeliveryType('pickup')}
                  className={`py-1.5 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    effectiveDeliveryType === 'pickup'
                      ? 'bg-amber-50 border-amber-300 text-amber-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <i className="bi bi-shop"></i>
                  Recoger en tienda
                </button>
              </div>

              {effectiveDeliveryType === 'pickup' ? (
                <p className="text-xs text-amber-700 font-medium bg-amber-50/70 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  <i className="bi bi-shop"></i>
                  El cliente retirará el pedido en la tienda
                </p>
              ) : primaryLocation ? (
                <button
                  type="button"
                  style={{ minHeight: 0 }}
                  onClick={() => setShowLocationsModal(true)}
                  className="w-full text-left bg-white hover:bg-emerald-50/40 border border-emerald-100 hover:border-emerald-200 rounded-lg px-3 py-2 text-xs text-gray-700 flex items-start justify-between gap-2 transition-colors"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <i className="bi bi-geo-alt-fill text-emerald-600 mt-0.5 shrink-0"></i>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                        Dirección guardada
                      </p>
                      <p className="font-medium text-gray-800 leading-snug">
                        {primaryLocation.referencia || primaryLocation.sector || 'Ubicación registrada'}
                        {primaryLocation.sector && primaryLocation.referencia ? ` · ${primaryLocation.sector}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                    {savedLocations.length > 1 ? `Ver todas (${savedLocations.length})` : 'Ver mapa'}
                  </span>
                </button>
              ) : (
                <input
                  ref={customLocationInputRef}
                  type="text"
                  value={customLocationInput}
                  onFocus={() => { focusedFieldRef.current = 'customLocation' }}
                  onChange={(e) => {
                    setCustomLocationInput(e.target.value)
                    if (deliveryType !== 'delivery') setDeliveryType('delivery')
                  }}
                  placeholder="Pegar enlace de Google Maps o dirección..."
                  className="w-full px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              )}
            </div>
          )}

          {activeTab === 'payment' && (
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-2.5 space-y-2 animate-in slide-in-from-bottom-2 duration-150">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-1.5">
                <i className="bi bi-credit-card-fill text-emerald-600"></i>
                Método de pago
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'cash' as const, label: 'Efectivo', icon: 'bi-cash-coin' },
                  { key: 'transfer' as const, label: 'Transfer.', icon: 'bi-bank' },
                  { key: 'mixed' as const, label: 'Mixto', icon: 'bi-wallet2' },
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    style={{ minHeight: 0 }}
                    onClick={() => setPaymentMethod(opt.key)}
                    className={`py-2 px-2 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      paymentMethod === opt.key
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-1 ring-emerald-300'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <i className={`bi ${opt.icon}`}></i>
                    {opt.label}
                  </button>
                ))}
              </div>
              {paymentMethod === 'mixed' && (
                <div className="grid grid-cols-2 gap-2 pt-0.5">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Efectivo ($)</label>
                    <input
                      ref={cashAmountInputRef}
                      type="number"
                      min="0"
                      step="0.01"
                      value={cashAmountInput}
                      onFocus={() => { focusedFieldRef.current = 'cashAmount' }}
                      onChange={(e) => setCashAmountInput(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Transferencia ($)</label>
                    <input
                      ref={transferAmountInputRef}
                      type="number"
                      min="0"
                      step="0.01"
                      value={transferAmountInput}
                      onFocus={() => { focusedFieldRef.current = 'transferAmount' }}
                      onChange={(e) => setTransferAmountInput(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
            </div>
          )}

          {/* Vista previa de enlace en vivo al escribir una URL (igual que WhatsApp) */}
          {(loadingLinkPreview || draftLinkPreview) && (
            <div className="flex items-stretch gap-2.5 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-150">
              {loadingLinkPreview && !draftLinkPreview ? (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
                  <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-green-600 rounded-full animate-spin shrink-0"></span>
                  <span>Cargando vista previa del enlace...</span>
                </div>
              ) : draftLinkPreview ? (
                <>
                  {draftLinkPreview.image && (
                    <div className="w-16 sm:w-20 shrink-0 bg-slate-200 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={draftLinkPreview.image}
                        alt={draftLinkPreview.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 py-2 pl-1 pr-1 space-y-0.5">
                    <p className="text-xs font-bold text-slate-900 line-clamp-1 leading-tight">
                      {draftLinkPreview.title}
                    </p>
                    {draftLinkPreview.description && (
                      <p className="text-[11px] text-slate-600 line-clamp-2 leading-snug">
                        {draftLinkPreview.description}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-400 truncate">
                      {draftLinkPreview.siteName}
                    </p>
                  </div>
                  <button
                    type="button"
                    style={{ minHeight: 0, minWidth: 0 }}
                    onClick={() => {
                      setDismissedPreviewUrl(draftLinkPreview.matchedText)
                      setDraftLinkPreview(null)
                    }}
                    title="Quitar vista previa"
                    className="self-start m-1.5 w-6 h-6 rounded-full hover:bg-slate-200/80 text-slate-500 inline-flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <i className="bi bi-x text-sm"></i>
                  </button>
                </>
              ) : null}
            </div>
          )}

          {/* Direct Reply Input Bar (envía por medio de la notificación activa en el teléfono Android) */}
          <div className="relative flex items-center gap-2">
            {/* Popover flotante de respuestas rápidas al escribir "/" */}
            {isQuickReplyMenuOpen && (
              <div className="absolute left-0 right-0 bottom-full mb-2.5 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden z-[70] animate-in fade-in slide-in-from-bottom-2 duration-150">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50/80">
                  <span className="text-[11px] font-bold text-slate-700 inline-flex items-center gap-1.5">
                    <i className="bi bi-lightning-charge-fill text-amber-500"></i>
                    Respuestas rápidas
                    {slashMatch?.query ? (
                      <span className="text-slate-400 font-medium">/{slashMatch.query}</span>
                    ) : null}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      style={{ minHeight: 0 }}
                      onClick={() => {
                        setShowNewQuickReplyForm((prev) => {
                          const next = !prev
                          if (next) {
                            setEditingQuickReplyId(null)
                            setNewQuickShortcut(slashMatch?.query || '')
                            setNewQuickMessage('')
                          } else {
                            setEditingQuickReplyId(null)
                          }
                          return next
                        })
                      }}
                      className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 px-2 py-0.5 rounded-md bg-emerald-50 hover:bg-emerald-100 transition-colors cursor-pointer"
                    >
                      {showNewQuickReplyForm ? 'Ver lista' : '+ Nueva'}
                    </button>
                    <button
                      type="button"
                      style={{ minHeight: 0, minWidth: 0 }}
                      onClick={() => setQuickReplyDismissed(true)}
                      className="w-6 h-6 rounded-full hover:bg-slate-200/80 text-slate-400 inline-flex items-center justify-center cursor-pointer"
                      title="Cerrar"
                    >
                      <i className="bi bi-x text-sm"></i>
                    </button>
                  </div>
                </div>

                {showNewQuickReplyForm ? (
                  <div className="p-3 space-y-2 bg-white">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-400">/</span>
                      <input
                        type="text"
                        value={newQuickShortcut}
                        onChange={(e) => setNewQuickShortcut(e.target.value)}
                        placeholder="atajo (ej. horario)"
                        className="flex-1 min-w-0 h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                      />
                    </div>
                    <textarea
                      rows={2}
                      value={newQuickMessage}
                      onChange={(e) => setNewQuickMessage(e.target.value)}
                      placeholder="Texto de la respuesta rápida..."
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        style={{ minHeight: 0 }}
                        onClick={() => {
                          setEditingQuickReplyId(null)
                          setShowNewQuickReplyForm(false)
                        }}
                        className="h-7 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        style={{ minHeight: 0 }}
                        disabled={!newQuickShortcut.trim() || !newQuickMessage.trim() || savingQuickReply}
                        onClick={() => void handleSaveQuickReply()}
                        className="h-7 px-3 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 rounded-lg cursor-pointer"
                      >
                        {savingQuickReply ? 'Guardando...' : editingQuickReplyId ? 'Actualizar' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 p-1">
                    {filteredQuickReplies.length === 0 ? (
                      <div className="py-4 px-3 text-center space-y-1.5">
                        <p className="text-xs text-slate-400">
                          Sin respuestas para <span className="font-bold text-slate-600">/{slashMatch?.query}</span>
                        </p>
                        <button
                          type="button"
                          style={{ minHeight: 0 }}
                          onClick={() => {
                            setNewQuickShortcut(slashMatch?.query || '')
                            setShowNewQuickReplyForm(true)
                          }}
                          className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
                        >
                          Crear respuesta /{slashMatch?.query || 'nueva'}
                        </button>
                      </div>
                    ) : (
                      filteredQuickReplies.map((item, idx) => {
                        const isSelected = idx === quickReplySelectedIdx
                        return (
                          <div
                            key={item.id}
                            className={`flex items-start gap-2 rounded-lg transition-colors ${
                              isSelected ? 'bg-emerald-50/90' : 'hover:bg-slate-50'
                            }`}
                          >
                            <button
                              type="button"
                              style={{ minHeight: 0 }}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => applyQuickReply(item.message)}
                              className="flex-1 min-w-0 text-left px-2.5 py-2 cursor-pointer"
                            >
                              <span className="inline-block text-[11px] font-black text-emerald-700">
                                /{item.shortcut}
                              </span>
                              <p className="text-xs text-slate-600 line-clamp-2 leading-snug mt-0.5">
                                {item.message}
                              </p>
                            </button>
                            <div className="flex items-center gap-0.5 p-1.5 shrink-0">
                              <button
                                type="button"
                                style={{ minHeight: 0, minWidth: 0 }}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => handleStartEditQuickReply(item)}
                                title="Editar respuesta rápida"
                                className="w-6 h-6 rounded-full hover:bg-slate-200/80 text-slate-400 hover:text-slate-700 inline-flex items-center justify-center shrink-0 cursor-pointer"
                              >
                                <i className="bi bi-pencil text-[11px]"></i>
                              </button>
                              <button
                                type="button"
                                style={{ minHeight: 0, minWidth: 0 }}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => void handleDeleteQuickReply(item)}
                                title="Eliminar respuesta rápida"
                                className="w-6 h-6 rounded-full hover:bg-rose-50 text-slate-300 hover:text-rose-500 inline-flex items-center justify-center shrink-0 cursor-pointer"
                              >
                                <i className="bi bi-trash3 text-[11px]"></i>
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )}
            <div ref={attachMenuRef} className="relative shrink-0">
              <button
                type="button"
                style={{ minHeight: 0, minWidth: 0 }}
                onClick={() => {
                  setShowAttachMenu((prev) => {
                    const next = !prev
                    if (!next) {
                      setAttachMenuView('main')
                      setAttachProductSearch('')
                    }
                    return next
                  })
                }}
                title="Añadir al mensaje"
                className="w-8 h-8 min-h-0 min-w-0 p-0 shrink-0 rounded-full bg-slate-200/80 hover:bg-slate-300/80 text-slate-900 transition-colors inline-flex items-center justify-center cursor-pointer"
              >
                <i className={`bi ${showAttachMenu ? 'bi-x-lg text-xs' : 'bi-plus-lg text-sm'}`}></i>
              </button>

              {showAttachMenu && (
                <div className="absolute left-0 bottom-full mb-2.5 w-72 sm:w-80 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden z-[70] animate-in fade-in slide-in-from-bottom-2 duration-150">
                  {attachMenuView === 'main' ? (
                    <div className="p-1.5 space-y-1">
                      <button
                        type="button"
                        style={{ minHeight: 0 }}
                        onClick={() => setAttachMenuView('products')}
                        className="w-full px-3 py-2 rounded-xl hover:bg-slate-50 text-left flex items-center gap-2.5 transition-colors cursor-pointer"
                      >
                        <span className="w-8 h-8 rounded-full bg-rose-50 text-rose-600 inline-flex items-center justify-center shrink-0">
                          <i className="bi bi-bag-heart-fill text-sm"></i>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-900 leading-tight">
                            Enlace de producto
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            Inserta un producto de tu menú
                          </p>
                        </div>
                        <i className="bi bi-chevron-right text-xs text-slate-400"></i>
                      </button>

                      {businessUsername && (
                        <button
                          type="button"
                          style={{ minHeight: 0 }}
                          onClick={() =>
                            insertLinkIntoReply(`https://www.fuddi.shop/${businessUsername}`)
                          }
                          className="w-full px-3 py-2 rounded-xl hover:bg-slate-50 text-left flex items-center gap-2.5 transition-colors cursor-pointer"
                        >
                          <span className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 inline-flex items-center justify-center shrink-0">
                            <i className="bi bi-shop text-sm"></i>
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-slate-900 leading-tight">
                              Enlace de mi menú
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
                              fuddi.shop/{businessUsername}
                            </p>
                          </div>
                        </button>
                      )}

                      <button
                        type="button"
                        style={{ minHeight: 0 }}
                        onClick={() => {
                          setShowAttachMenu(false)
                          setQuickReplyDismissed(false)
                          setReplyText((prev) => {
                            const trimmed = prev.trim()
                            return trimmed ? `${trimmed} /` : '/'
                          })
                          setTimeout(() => replyInputRef.current?.focus(), 30)
                        }}
                        className="w-full px-3 py-2 rounded-xl hover:bg-slate-50 text-left flex items-center gap-2.5 transition-colors cursor-pointer"
                      >
                        <span className="w-8 h-8 rounded-full bg-amber-50 text-amber-600 inline-flex items-center justify-center shrink-0">
                          <i className="bi bi-lightning-charge-fill text-sm"></i>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-900 leading-tight">
                            Respuestas rápidas
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            También puedes escribir / en el chat
                          </p>
                        </div>
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col max-h-72">
                      <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-slate-100 bg-slate-50/70">
                        <button
                          type="button"
                          style={{ minHeight: 0, minWidth: 0 }}
                          onClick={() => {
                            setAttachMenuView('main')
                            setAttachProductSearch('')
                          }}
                          className="w-6 h-6 rounded-full hover:bg-slate-200/80 text-slate-600 inline-flex items-center justify-center shrink-0 cursor-pointer"
                          title="Volver"
                        >
                          <i className="bi bi-arrow-left text-xs"></i>
                        </button>
                        <input
                          type="text"
                          value={attachProductSearch}
                          onChange={(e) => setAttachProductSearch(e.target.value)}
                          placeholder="Buscar producto del menú..."
                          autoFocus
                          className="flex-1 min-w-0 h-7 px-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                        />
                      </div>

                      <div className="overflow-y-auto divide-y divide-slate-100 p-1">
                        {!businessUsername ? (
                          <p className="text-[11px] text-slate-400 text-center py-4 px-3">
                            Cargando enlace de tu tienda...
                          </p>
                        ) : attachableProducts.length === 0 ? (
                          <p className="text-[11px] text-slate-400 text-center py-4 px-3">
                            No se encontraron productos
                          </p>
                        ) : (
                          attachableProducts.map((prod) => {
                            const slug =
                              prod.slug || generateProductSlug(businessUsername, prod.id)
                            const prodUrl = `https://www.fuddi.shop/${businessUsername}/${slug}`
                            const price = getManualOrderStorePrice(prod)
                            return (
                              <button
                                key={prod.id}
                                type="button"
                                style={{ minHeight: 0 }}
                                onClick={() => insertLinkIntoReply(prodUrl)}
                                className="w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 text-left flex items-center gap-2 transition-colors cursor-pointer"
                              >
                                {prod.image ? (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img
                                    src={prod.image}
                                    alt={prod.name}
                                    className="w-9 h-9 rounded-lg object-cover bg-slate-100 shrink-0 border border-slate-200/70"
                                  />
                                ) : (
                                  <span className="w-9 h-9 rounded-lg bg-slate-100 text-slate-400 inline-flex items-center justify-center shrink-0">
                                    <i className="bi bi-bag text-sm"></i>
                                  </span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-bold text-slate-900 truncate leading-tight">
                                    {prod.name}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    ${price.toFixed(2)}
                                  </p>
                                </div>
                                <i className="bi bi-link-45deg text-base text-slate-400 shrink-0"></i>
                              </button>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <input
              ref={replyInputRef}
              type="text"
              value={replyText}
              onChange={(e) => {
                setReplyText(e.target.value)
                setQuickReplyDismissed(false)
              }}
              onKeyDown={(e) => {
                if (isQuickReplyMenuOpen && !showNewQuickReplyForm && filteredQuickReplies.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setQuickReplySelectedIdx((prev) => (prev + 1) % filteredQuickReplies.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setQuickReplySelectedIdx(
                      (prev) => (prev - 1 + filteredQuickReplies.length) % filteredQuickReplies.length
                    )
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    const chosen = filteredQuickReplies[quickReplySelectedIdx] || filteredQuickReplies[0]
                    if (chosen) applyQuickReply(chosen.message)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setQuickReplyDismissed(true)
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSendDirectReply()
                }
              }}
              placeholder="Escribe un mensaje o / para respuestas rápidas..."
              className="flex-1 min-w-0 h-8 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-400"
            />
            {replyText.trim() ? (
              <button
                type="button"
                style={{ minHeight: 0, minWidth: 0 }}
                disabled={sendingReply}
                onClick={() => void handleSendDirectReply()}
                className="w-8 h-8 min-h-0 min-w-0 p-0 shrink-0 rounded-full bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white shadow-xs transition-colors inline-flex items-center justify-center cursor-pointer"
                title="Enviar"
              >
                <i className="bi bi-send-fill text-xs"></i>
              </button>
            ) : (
              <button
                type="button"
                style={{ minHeight: 0, minWidth: 0 }}
                onClick={() => onCreateOrder(enrichedConversation, buildDraft())}
                className="w-8 h-8 min-h-0 min-w-0 p-0 shrink-0 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-xs transition-colors inline-flex items-center justify-center cursor-pointer"
                title="Crear pedido"
              >
                <i className="bi bi-cart-plus-fill text-xs"></i>
              </button>
            )}
          </div>
        </div>
      </div>

      <ClientLocationsModal
        isOpen={showLocationsModal}
        title="Seleccionar ubicación"
        subtitle={displayName}
        locations={savedLocations}
        selectedLocationId={primaryLocation?.id}
        onClose={() => setShowLocationsModal(false)}
        onSelectLocation={(location) => {
          setSelectedLocationId(location.id)
          setDeliveryType('delivery')
          setShowLocationsModal(false)
        }}
      />

      {previewImageModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setPreviewImageModal(null)}
        >
          <div
            className="relative max-w-2xl w-full max-h-[90dvh] flex flex-col items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              style={{ minHeight: 0, minWidth: 0 }}
              onClick={() => setPreviewImageModal(null)}
              className="self-end w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center transition-colors cursor-pointer"
              title="Cerrar"
            >
              <i className="bi bi-x-lg text-base"></i>
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImageModal.url}
              alt={previewImageModal.caption || 'Imagen ampliada'}
              className="max-w-full max-h-[78dvh] object-contain rounded-xl shadow-2xl bg-black/40"
            />
            {previewImageModal.caption && (
              <p className="text-xs text-white/90 bg-black/60 px-3 py-1.5 rounded-lg max-w-full text-center whitespace-pre-wrap break-words">
                {previewImageModal.caption}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
