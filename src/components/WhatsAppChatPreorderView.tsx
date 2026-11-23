'use client'

import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Product } from '@/types'
import type { PendingWhatsAppConversation } from '@/components/WhatsAppPendingModal'
import { searchClientByPhone, getClientLocations, createClient, type ClientLocation } from '@/lib/database'
import { ClientLocationsModal } from '@/components/ClientLocationsModal'
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

function getTodayDateString(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
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
  const [optimisticReply, setOptimisticReply] = useState<{ id: string; text: string } | null>(null)
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
    scrollMessagesToBottom(false)
    const raf = requestAnimationFrame(() => scrollMessagesToBottom(false))
    return () => cancelAnimationFrame(raf)
  }, [chatMessageCount, lastChatTimestamp, optimisticReply?.id, activeTab, scrollMessagesToBottom])

  const handleSendDirectReply = async () => {
    const cleanText = replyText.trim()
    if (!cleanText || !businessId || !conversation.docId || sendingReply) return
    setReplyText('')
    setSendingReply(true)
    const replyId = `web_${Date.now()}`
    setOptimisticReply({ id: replyId, text: cleanText })
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
          {Array.isArray(conversation.chatHistory) && conversation.chatHistory.length > 0 ? (
            [...conversation.chatHistory]
              .sort((a, b) => (a.timestampMillis || 0) - (b.timestampMillis || 0))
              .map((msg, idx) =>
                msg.fromMe ? (
                  <div
                    key={msg.id || `me-${idx}`}
                    className="self-end max-w-[88%] sm:max-w-[75%] bg-[#dcf8c6] border border-emerald-200/90 rounded-xl rounded-tr-xs px-3 py-1.5 text-xs text-slate-800 shadow-2xs"
                  >
                    <p className="whitespace-pre-wrap break-words leading-snug">{msg.text}</p>
                    <div className="flex items-center justify-end gap-1 pt-0.5 text-[10px] text-emerald-800/80">
                      <span>{formatWhatsAppTime(msg.timestampMillis)}</span>
                      <i className="bi bi-check2-all text-sky-600 text-xs"></i>
                    </div>
                  </div>
                ) : (
                  <button
                    key={msg.id || `in-${idx}`}
                    type="button"
                    style={{ minHeight: 0 }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handlePasteMessageToActiveField(msg.text)}
                    title="Toca para pegar en el campo activo"
                    className="max-w-[88%] text-left bg-white hover:bg-blue-50/50 border border-slate-200/90 hover:border-blue-300 rounded-xl px-2.5 py-1.5 text-xs leading-snug text-slate-800 whitespace-pre-wrap break-words transition-colors cursor-pointer shadow-2xs space-y-1.5"
                  >
                    {msg.mediaUrl && (msg.mediaType === 'image' || msg.mediaType === 'order') && (
                      <a
                        href={msg.mediaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-100 max-w-[240px]"
                        title="Clic para abrir imagen en tamaño completo"
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
                      </a>
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
                  </button>
                )
              )
          ) : messages.length > 0 ? (
            messages.map((msg, idx) => (
              <button
                key={idx}
                type="button"
                style={{ minHeight: 0 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handlePasteMessageToActiveField(msg)}
                title="Toca para pegar en el campo activo"
                className="max-w-[88%] text-left bg-white hover:bg-blue-50/50 border border-slate-200/90 hover:border-blue-300 rounded-xl px-2.5 py-1.5 text-xs leading-snug text-slate-800 whitespace-pre-wrap break-words transition-colors cursor-pointer shadow-2xs"
              >
                {msg}
              </button>
            ))
          ) : (
            <p className="w-full text-xs text-slate-400 bg-white rounded-xl border border-slate-200 px-3 py-4 text-center">
              Sin mensajes registrados
            </p>
          )}

          {conversation.detectedLocationLink && (
            <a
              href={conversation.detectedLocationLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 pt-1"
            >
              <i className="bi bi-geo-alt-fill"></i>
              Ver ubicación enviada en Maps
            </a>
          )}

          {/* Respuestas enviadas (fallback si aún no hay chatHistory) */}
          {(!Array.isArray(conversation.chatHistory) || conversation.chatHistory.length === 0) &&
            Array.isArray(conversation.sentReplies) &&
            conversation.sentReplies.map((reply) => (
              <div
                key={reply.id}
                className="self-end max-w-[88%] sm:max-w-[75%] bg-[#dcf8c6] border border-emerald-200/90 rounded-xl rounded-tr-xs px-3 py-1.5 text-xs text-slate-800 shadow-2xs"
              >
                <p className="whitespace-pre-wrap break-words leading-snug">{reply.text}</p>
                <div className="flex items-center justify-end gap-1 pt-0.5 text-[10px] text-emerald-800/80">
                  <span>{formatWhatsAppTime(reply.timestampMillis)}</span>
                  <i className="bi bi-check2-all text-sky-600 text-xs"></i>
                </div>
              </div>
            ))}

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

          {/* Sent Order Bubbles (aligned right, WhatsApp outgoing style) */}
          {sentOrderBubbles.map(({ order, createdMs }) => {
            const items = Array.isArray(order.items) ? order.items : []
            const isPickupOrder = order.delivery?.type === 'pickup'
            const orderTime = formatWhatsAppTime(createdMs || Date.now())
            const canInspect = Boolean(onInspectOrder && !order._fallbackSummary)
            return (
              <div
                key={`sent-order-${order.id}`}
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
          })}
        </div>
      </div>

      {/* Bottom Footer: Active Form + Actions (siempre fijo abajo y visible) */}
      <div className="bg-white border-t border-slate-200 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] shrink-0 max-h-[60dvh] overflow-y-auto">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 py-2.5 space-y-2.5">
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

          {/* Direct Reply Input Bar (envía por medio de la notificación activa en el teléfono Android) */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSendDirectReply()
                }
              }}
              placeholder="Responder al cliente por WhatsApp..."
              className="flex-1 min-w-0 h-8 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-400"
            />
            <button
              type="button"
              style={{ minHeight: 0 }}
              disabled={!replyText.trim() || sendingReply}
              onClick={() => void handleSendDirectReply()}
              className="h-8 min-h-0 px-3 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
              title="Enviar respuesta directa usando la notificación del teléfono"
            >
              <i className="bi bi-send-fill text-[11px]"></i>
              <span>Enviar</span>
            </button>
          </div>

          {/* Bottom Actions Bar */}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div>
              {cleanPhone && (
                <a
                  href={`https://wa.me/${cleanPhone}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ minHeight: 0 }}
                  className="h-8 min-h-0 px-3 bg-white hover:bg-green-50 text-green-700 border border-green-200 text-xs font-bold rounded-lg transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  <i className="bi bi-whatsapp"></i>
                  Chat
                </a>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {onCloseConversation && (
                <button
                  type="button"
                  style={{ minHeight: 0 }}
                  onClick={() => {
                    onCloseConversation(conversation.docId)
                    onBack()
                  }}
                  className="h-8 min-h-0 inline-flex items-center justify-center gap-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 text-xs font-bold px-3 rounded-lg transition-colors"
                >
                  <i className="bi bi-archive"></i>
                  Archivar
                </button>
              )}
              <button
                type="button"
                style={{ minHeight: 0 }}
                onClick={() => onCreateOrder(enrichedConversation, buildDraft())}
                className="h-8 min-h-0 inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3.5 rounded-lg shadow-xs transition-colors"
              >
                <i className="bi bi-cart-plus-fill"></i>
                Crear pedido
              </button>
            </div>
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
    </div>
  )
}
