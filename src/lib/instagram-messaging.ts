import crypto from 'crypto'
import { ensureAdminDb } from '@/lib/firebase-admin'
import { getEcuadorDate, isStoreOpen } from '@/lib/store-utils'
import { evaluateAndGenerateAutoAiReply } from '@/lib/ai-chat-agent'

export interface InstagramConnectionInfo {
  status: 'connected' | 'disconnected'
  instagramAccountId: string | null
  instagramUsername: string | null
  accessToken?: string | null
  tokenExpiresAtMillis?: number | null
  updatedAtMillis: number
}

const MAX_RECENT_MESSAGES = 8
const MAX_CHAT_HISTORY = 24

export function verifyInstagramWebhookSignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  // Meta firma los webhooks con el App Secret de la App Principal (META_APP_SECRET),
  // que es diferente al Instagram App Secret usado en OAuth.
  const metaAppSecret = process.env.META_APP_SECRET?.trim()
  if (!metaAppSecret) return true
  if (!signatureHeader) return false

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', metaAppSecret).update(rawBody, 'utf8').digest('hex')

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))
  } catch {
    return false
  }
}

function isWithinAutoReplySchedule(
  daysOfWeek: number[],
  startTime: string,
  endTime: string,
  now: Date = new Date()
): boolean {
  const parseHHMM = (val: string): number | null => {
    const match = String(val || '').trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!match) return null
    const h = parseInt(match[1], 10)
    const m = parseInt(match[2], 10)
    if (h < 0 || h > 23 || m < 0 || m > 59) return null
    return h * 60 + m
  }
  const startMin = parseHHMM(startTime)
  const endMin = parseHHMM(endTime)
  if (startMin === null || endMin === null) return false

  const { dayOfWeekIndex, hours, minutes } = getEcuadorDate(now)
  const normalizedHours = hours === 24 ? 0 : hours
  const nowMin = normalizedHours * 60 + minutes
  const activeDays =
    Array.isArray(daysOfWeek) && daysOfWeek.length > 0 ? daysOfWeek : [0, 1, 2, 3, 4, 5, 6]

  if (startMin <= endMin) {
    return activeDays.includes(dayOfWeekIndex) && nowMin >= startMin && nowMin <= endMin
  }
  const prevDayIndex = (dayOfWeekIndex + 6) % 7
  if (nowMin >= startMin) return activeDays.includes(dayOfWeekIndex)
  if (nowMin <= endMin) return activeDays.includes(prevDayIndex)
  return false
}

export async function fetchInstagramUserProfile(
  igUserId: string,
  accessToken: string
): Promise<{ name?: string; username?: string } | null> {
  try {
    const url = `https://graph.instagram.com/v21.0/${encodeURIComponent(
      igUserId
    )}?fields=name,username&access_token=${encodeURIComponent(accessToken)}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return {
      name: typeof data?.name === 'string' ? data.name : undefined,
      username: typeof data?.username === 'string' ? data.username : undefined,
    }
  } catch {
    return null
  }
}

export async function sendInstagramDirectMessage(params: {
  businessId: string
  docId?: string
  recipientId: string
  text: string
  mediaUrl?: string | null
  sourceOverride?: string
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { businessId, recipientId, text, mediaUrl } = params
  const cleanText = String(text || '').trim()
  const cleanMediaUrl = String(mediaUrl || '').trim()
  const cleanRecipientId = String(recipientId || '').replace(/^ig:/, '').trim()

  if (!businessId || !cleanRecipientId) {
    return { ok: false, error: 'Faltan businessId o recipientId de Instagram' }
  }
  if (!cleanText && !cleanMediaUrl) {
    return { ok: false, error: 'El mensaje no puede estar vacío' }
  }

  const db = ensureAdminDb()
  if (!db) return { ok: false, error: 'Base de datos no disponible' }

  const connSnap = await db
    .collection('businesses')
    .doc(businessId)
    .collection('instagramConnection')
    .doc('status')
    .get()

  if (!connSnap.exists) {
    return { ok: false, error: 'Instagram no está conectado para esta tienda.' }
  }
  const connData = connSnap.data() || {}
  const accessToken = String(connData.accessToken || '').trim()
  if (connData.status !== 'connected' || !accessToken) {
    return { ok: false, error: 'Token de Instagram no válido o desconectado.' }
  }

  const messagePayload: Record<string, any> = cleanMediaUrl
    ? {
        attachment: {
          type: 'image',
          payload: { url: cleanMediaUrl },
        },
      }
    : { text: cleanText }

  try {
    const graphRes = await fetch(
      `https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: cleanRecipientId },
          message: messagePayload,
        }),
      }
    )

    const graphData = await graphRes.json().catch(() => ({}))
    if (!graphRes.ok) {
      const apiErr =
        graphData?.error?.message || `Error HTTP ${graphRes.status} enviando mensaje a Instagram`
      return { ok: false, error: apiErr }
    }

    const sentMsgId = String(graphData?.message_id || `ig_out_${Date.now()}`)
    const nowMs = Date.now()
    const resolvedDocId = String(params.docId || `ig:${cleanRecipientId}`).trim()

    // Registrar el mensaje saliente en la conversación unificada
    const docRef = db
      .collection('businesses')
      .doc(businessId)
      .collection('whatsappPending')
      .doc(resolvedDocId)

    const existingSnap = await docRef.get().catch(() => null)
    const existing = existingSnap?.exists ? existingSnap.data() || {} : {}
    const prevHistory: any[] = Array.isArray(existing.chatHistory) ? existing.chatHistory : []

    const outgoingEntry = {
      id: params.sourceOverride === 'ai_agent' ? `ai_${sentMsgId}` : sentMsgId,
      text: cleanText || (cleanMediaUrl ? '📷 Imagen enviada' : ''),
      timestampMillis: nowMs,
      fromMe: true,
      source: params.sourceOverride || 'instagram',
      ...(cleanMediaUrl ? { mediaUrl: cleanMediaUrl, mediaType: 'image' } : {}),
    }

    const nextHistory = [
      ...prevHistory.filter((h) => h?.id !== sentMsgId),
      outgoingEntry,
    ].slice(-MAX_CHAT_HISTORY)

    await docRef.set(
      {
        id: resolvedDocId,
        channel: 'instagram',
        sourcePackage: 'instagram',
        instagramSenderId: cleanRecipientId,
        chatHistory: nextHistory,
        lastMessage: outgoingEntry.text,
        timestampMillis: nowMs,
        unreadCount: 0,
        canReplyDirectly: true,
      },
      { merge: true }
    )

    return { ok: true, messageId: sentMsgId }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Error al enviar mensaje de Instagram' }
  }
}

async function processAutoRepliesForInstagramMessage(
  businessId: string,
  docRef: FirebaseFirestore.DocumentReference,
  docId: string,
  senderId: string,
  existingDocData: Record<string, any>
) {
  const db = ensureAdminDb()
  if (!db) return

  const rulesSnap = await db
    .collection('businesses')
    .doc(businessId)
    .collection('whatsappAutoReplies')
    .where('enabled', '==', true)
    .get()

  if (rulesSnap.empty) return

  const rules = rulesSnap.docs
    .map((d): Record<string, any> => ({ id: d.id, ...(d.data() as Record<string, any>) }))
    .filter((r) => String(r.message || '').trim().length > 0)
    .sort((a, b) => Number(a.order ?? a.createdAtMillis ?? 0) - Number(b.order ?? b.createdAtMillis ?? 0))

  if (rules.length === 0) return

  const needsStoreStatus = rules.some(
    (r) => r.triggerMode === 'store_open' || r.triggerMode === 'store_closed'
  )
  let storeIsOpenCached: boolean | null = null
  if (needsStoreStatus) {
    try {
      const bizSnap = await db.collection('businesses').doc(businessId).get()
      if (bizSnap.exists) {
        storeIsOpenCached = isStoreOpen({ id: bizSnap.id, ...(bizSnap.data() as any) })
      }
    } catch {
      // Ignorar
    }
  }

  const now = new Date()
  const nowMs = now.getTime()
  const persistedLastSent: Record<string, number> =
    existingDocData?.autoReplyLastSent && typeof existingDocData.autoReplyLastSent === 'object'
      ? existingDocData.autoReplyLastSent
      : {}

  const sentUpdates: Record<string, number> = {}

  for (const rule of rules) {
    const mode = String(rule.triggerMode || 'always')
    let matchesCondition = false
    if (mode === 'always') matchesCondition = true
    else if (mode === 'store_open') matchesCondition = storeIsOpenCached === true
    else if (mode === 'store_closed') matchesCondition = storeIsOpenCached === false
    else if (mode === 'schedule') {
      matchesCondition = isWithinAutoReplySchedule(
        Array.isArray(rule.daysOfWeek) ? rule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
        String(rule.startTime || '00:00'),
        String(rule.endTime || '23:59'),
        now
      )
    }
    if (!matchesCondition) continue

    const cooldownHours = Math.max(0, Number(rule.cooldownHours ?? 12))
    const cooldownMs = cooldownHours * 60 * 60 * 1000
    const lastSentMs = Number(persistedLastSent[rule.id] || 0)
    if (cooldownMs > 0 && nowMs - lastSentMs < cooldownMs) continue

    const res = await sendInstagramDirectMessage({
      businessId,
      docId,
      recipientId: senderId,
      text: String(rule.message).trim(),
    })

    if (res.ok) {
      sentUpdates[`autoReplyLastSent.${rule.id}`] = nowMs
    }
  }

  if (Object.keys(sentUpdates).length > 0) {
    await docRef.update(sentUpdates).catch(() => {})
  }
}

export async function processIncomingInstagramWebhook(body: any): Promise<{ processed: number }> {
  if (!body || body.object !== 'instagram' || !Array.isArray(body.entry)) {
    return { processed: 0 }
  }

  const db = ensureAdminDb()
  if (!db) return { processed: 0 }

  let processed = 0

  for (const entry of body.entry) {
    const igAccountId = String(entry?.id || '').trim()
    if (!igAccountId) continue

    const indexSnap = await db.collection('instagramAccountsIndex').doc(igAccountId).get()
    if (!indexSnap.exists) {
      console.warn(`[Instagram Webhook] igAccountId=${igAccountId} no encontrado en instagramAccountsIndex`)
      continue
    }
    const businessId = String(indexSnap.data()?.businessId || '').trim()
    if (!businessId) continue

    const connSnap = await db
      .collection('businesses')
      .doc(businessId)
      .collection('instagramConnection')
      .doc('status')
      .get()
    const accessToken = String(connSnap.data()?.accessToken || '').trim()

    // Soportar tanto entry.messaging[] como entry.changes[] (field === 'messages')
    const messagingFromChanges = Array.isArray(entry.changes)
      ? entry.changes
          .filter((c: any) => c?.field === 'messages' && c?.value)
          .map((c: any) => c.value)
      : []
    const messagingList = [
      ...(Array.isArray(entry.messaging) ? entry.messaging : []),
      ...messagingFromChanges,
    ]
    for (const event of messagingList) {
      const msg = event?.message
      if (!msg) continue
      const isEcho = Boolean(msg.is_echo)
      const senderId = String(event?.sender?.id || '').trim()
      const recipientId = String(event?.recipient?.id || '').trim()
      const customerIgId = isEcho ? recipientId : senderId
      if (!customerIgId || customerIgId === igAccountId) continue

      const msgId = String(msg.mid || `ig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)
      const msgMillis = Number(event?.timestamp || Date.now())
      const nowMillis = Date.now()

      const attachments = Array.isArray(msg.attachments) ? msg.attachments : []
      const firstAttachment = attachments[0]
      const mediaUrl = firstAttachment?.payload?.url || ''
      const mediaType =
        firstAttachment?.type === 'image'
          ? 'image'
          : firstAttachment?.type === 'audio'
          ? 'audio'
          : firstAttachment?.type === 'video'
          ? 'video'
          : undefined

      const rawText = String(msg.text || '').trim()
      const text =
        rawText ||
        (mediaType === 'image'
          ? '📷 Imagen'
          : mediaType === 'audio'
          ? '🎵 Audio'
          : mediaType === 'video'
          ? '🎬 Video'
          : attachments.length > 0
          ? '📎 Adjunto de Instagram'
          : '')

      if (!text && !mediaUrl) continue

      const docId = `ig:${customerIgId}`
      const docRef = db
        .collection('businesses')
        .doc(businessId)
        .collection('whatsappPending')
        .doc(docId)

      const existingSnap = await docRef.get().catch(() => null)
      const existing = existingSnap?.exists ? existingSnap.data() || {} : {}

      // Resolver perfil (nombre / @username) si aún no está guardado
      let igUsername = String(existing.instagramUsername || '').trim()
      let displayName = String(existing.displayName || '').trim()
      if (!igUsername && accessToken) {
        const profile = await fetchInstagramUserProfile(customerIgId, accessToken)
        if (profile?.username) igUsername = profile.username
        if (profile?.name) displayName = profile.name
      }
      const effectiveName =
        displayName || (igUsername ? `@${igUsername}` : `Instagram ${customerIgId.slice(-4)}`)

      const prevHistory: any[] = Array.isArray(existing.chatHistory) ? existing.chatHistory : []
      if (prevHistory.some((h) => h?.id === msgId)) {
        continue // Evitar duplicados por reintentos del webhook de Meta
      }

      const newEntry = {
        id: msgId,
        text,
        timestampMillis: Math.max(nowMillis, msgMillis),
        fromMe: isEcho,
        source: 'instagram',
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(mediaType ? { mediaType } : {}),
      }

      const nextHistory = [...prevHistory, newEntry].slice(-MAX_CHAT_HISTORY)
      const prevRecent: string[] = Array.isArray(existing.recentMessages)
        ? existing.recentMessages
        : []
      const nextRecent = isEcho ? prevRecent : [...prevRecent, text].slice(-MAX_RECENT_MESSAGES)
      const prevUnread = typeof existing.unreadCount === 'number' ? existing.unreadCount : 0

      await docRef.set(
        {
          id: docId,
          channel: 'instagram',
          sourcePackage: 'instagram',
          instagramSenderId: customerIgId,
          instagramUsername: igUsername || null,
          phone: igUsername ? `@${igUsername}` : '',
          rawPhone: '',
          displayName: effectiveName,
          effectiveName,
          lastMessage: text,
          recentMessages: nextRecent,
          chatHistory: nextHistory,
          timestampMillis: Math.max(nowMillis, msgMillis),
          unreadCount: isEcho ? 0 : prevUnread + 1,
          canReplyDirectly: true,
          status: 'pending',
        },
        { merge: true }
      )

      processed++

      if (!isEcho) {
        void processAutoRepliesForInstagramMessage(
          businessId,
          docRef,
          docId,
          customerIgId,
          existing
        ).catch(() => {})

        void evaluateAndGenerateAutoAiReply({
          businessId,
          channel: 'instagram',
          existingDocData: existing,
          chatHistory: nextHistory,
          incomingText: text,
          customerName: effectiveName,
        })
          .then(async (aiResult) => {
            if (!aiResult?.ok || !aiResult.reply) return
            const sendRes = await sendInstagramDirectMessage({
              businessId,
              docId,
              recipientId: customerIgId,
              text: aiResult.reply,
              sourceOverride: 'ai_agent',
            })
            if (sendRes.ok) {
              await docRef
                .set(
                  {
                    aiLastRepliedAtMillis: Date.now(),
                    aiLastProvider: aiResult.provider || null,
                    ...(aiResult.preorderState !== undefined
                      ? { preorderState: aiResult.preorderState }
                      : {}),
                  },
                  { merge: true }
                )
                .catch(() => {})
            }
          })
          .catch(() => {})
      }
    }
  }

  return { processed }
}
