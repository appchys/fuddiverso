import type {
  AuthenticationCreds,
  AuthenticationState,
  proto,
  SignalDataTypeMap,
  WASocket,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import QRCode from 'qrcode'
import { ensureAdminDb, uploadWhatsAppMediaToStorage } from '@/lib/firebase-admin'

type BaileysModule = typeof import('@whiskeysockets/baileys')

let cachedBaileysModule: BaileysModule | null = null
async function loadBaileys(): Promise<BaileysModule> {
  if (!cachedBaileysModule) {
    // Referencia estática para que @vercel/nft trace todas las dependencias transitivas de Baileys en Vercel
    cachedBaileysModule = await import('@whiskeysockets/baileys')
  }
  return cachedBaileysModule
}

export type BaileysConnectionStatus = 'disconnected' | 'connecting' | 'qr' | 'connected'

export interface BaileysBusinessState {
  businessId: string
  status: BaileysConnectionStatus
  qrDataUrl: string | null
  pairingCode: string | null
  connectedPhone: string | null
  connectedName: string | null
  lastError: string | null
  updatedAtMillis: number
}

interface ManagedSession {
  businessId: string
  socket: WASocket | null
  state: BaileysBusinessState
  firestoreUnsub: (() => void) | null
  excludedUnsub: (() => void) | null
  excludedPhones: Set<string>
  processedReplyIds: Set<string>
  sentByBridgeMsgIds: Set<string>
  reconnectTimer: ReturnType<typeof setTimeout> | null
  isConnecting: boolean
  manualDisconnect: boolean
  stateWaiters: Array<() => void>
}

const MAX_RECENT_MESSAGES = 8
const MAX_CHAT_HISTORY = 24

export function isWhatsAppLidDigits(raw?: string | null): boolean {
  const digits = String(raw || '').replace(/\D/g, '')
  return (
    digits.length >= 13 &&
    !digits.startsWith('593') &&
    !digits.startsWith('00593')
  )
}

export function normalizeEcuadorPhone(raw?: string | null): string {
  if (!raw) return ''
  const trimmed = String(raw).trim()
  if (trimmed.endsWith('@lid')) {
    return trimmed.split('@')[0].replace(/\D/g, '')
  }
  let digits = trimmed.replace(/\D/g, '')
  if (isWhatsAppLidDigits(digits)) {
    return digits
  }
  if (digits.startsWith('00593')) {
    digits = digits.slice(5)
  } else if (digits.startsWith('593') && digits.length >= 11) {
    digits = digits.slice(3)
  }
  if (digits.length === 11 && digits.startsWith('009')) {
    digits = digits.slice(1)
  } else if (digits.length === 9 && digits.startsWith('9')) {
    digits = `0${digits}`
  }
  return digits
}

export function ecuadorPhoneToIntlDigits(rawPhone: string): string | null {
  const digits = String(rawPhone || '').replace(/\D/g, '')
  if (digits.length < 9) return null
  if (digits.startsWith('00593') && digits.length >= 14) {
    return `593${digits.slice(5)}`
  }
  if (digits.length === 10 && digits.startsWith('09')) {
    return `593${digits.slice(1)}`
  }
  if (digits.length === 9 && digits.startsWith('9')) {
    return `593${digits}`
  }
  return digits
}

export function ecuadorPhoneToJid(
  rawPhoneOrJid: string,
  explicitWhatsappJid?: string | null
): string | null {
  const cleanExplicit = String(explicitWhatsappJid || '').trim()
  if (
    cleanExplicit &&
    (cleanExplicit.endsWith('@s.whatsapp.net') || cleanExplicit.endsWith('@lid'))
  ) {
    return cleanExplicit
  }
  const cleanInput = String(rawPhoneOrJid || '').trim()
  if (cleanInput.endsWith('@s.whatsapp.net') || cleanInput.endsWith('@lid')) {
    return cleanInput
  }
  const digits = cleanInput.replace(/\D/g, '')
  if (digits.length < 9) return null
  // Si es un identificador LID de WhatsApp Business (13-16 dígitos que no son teléfono 593)
  if (isWhatsAppLidDigits(digits)) {
    return `${digits}@lid`
  }
  const intl = ecuadorPhoneToIntlDigits(digits)
  return intl ? `${intl}@s.whatsapp.net` : null
}

function extractLocationLinkFromText(text: string): string | null {
  const urlMatch = text.match(
    /(https?:\/\/(?:maps\.app\.goo\.gl|www\.google\.com\/maps|maps\.google\.com|goo\.gl\/maps)[^\s]+)/i
  )
  if (urlMatch?.[1]) return urlMatch[1]
  const coordMatch = text.match(/([-+]?\d{1,2}\.\d{4,},\s*[-+]?\d{1,3}\.\d{4,})/)
  if (coordMatch?.[1]) return coordMatch[1]
  return null
}

function parseVcardSummary(displayName?: string | null, vcard?: string | null): string {
  const rawVcard = String(vcard || '')
  let name = String(displayName || '').trim()
  if (!name) {
    const fnMatch = rawVcard.match(/^FN[;:](.+)$/im)
    if (fnMatch?.[1]) {
      name = fnMatch[1].trim()
    }
  }
  const phones: string[] = []
  const telRegex = /TEL[^:]*:([+\d\s\-()]+)/gi
  let match: RegExpExecArray | null
  while ((match = telRegex.exec(rawVcard)) !== null) {
    const rawNum = match[1].trim()
    const norm = normalizeEcuadorPhone(rawNum) || rawNum
    if (norm && !phones.includes(norm)) {
      phones.push(norm)
    }
  }
  const label = name || 'Contacto'
  return phones.length > 0
    ? `👤 Contacto: ${label} — ${phones.join(', ')}`
    : `👤 Contacto: ${label}`
}

interface ExtractedRichContent {
  text: string
  locationLink: string | null
  mediaUrl?: string | null
  mediaType?: 'image' | 'document' | 'audio' | 'order' | 'contact' | 'location' | null
  fileName?: string | null
}

async function extractRichMessageContent(
  session: ManagedSession,
  msg: proto.IWebMessageInfo,
  logger: any
): Promise<ExtractedRichContent> {
  const m = msg.message
  if (!m) return { text: '', locationLink: null }

  const inner =
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.viewOnceMessageV2Extension?.message ||
    m.documentWithCaptionMessage?.message ||
    m

  // 1. Ubicaciones (fijas o en tiempo real)
  if (inner.locationMessage) {
    const lat = inner.locationMessage.degreesLatitude
    const lng = inner.locationMessage.degreesLongitude
    if (typeof lat === 'number' && typeof lng === 'number') {
      const link = `https://www.google.com/maps?q=${lat},${lng}`
      const label = inner.locationMessage.name || inner.locationMessage.address || 'Ubicación enviada'
      return { text: `📍 ${label}: ${link}`, locationLink: link, mediaType: 'location' }
    }
  }

  if (inner.liveLocationMessage) {
    const lat = inner.liveLocationMessage.degreesLatitude
    const lng = inner.liveLocationMessage.degreesLongitude
    if (typeof lat === 'number' && typeof lng === 'number') {
      const link = `https://www.google.com/maps?q=${lat},${lng}`
      const caption = inner.liveLocationMessage.caption || 'Ubicación en tiempo real'
      return { text: `📍 ${caption}: ${link}`, locationLink: link, mediaType: 'location' }
    }
  }

  // 2. Contactos (individual o lista de contactos)
  if (inner.contactMessage) {
    const summary = parseVcardSummary(
      inner.contactMessage.displayName,
      inner.contactMessage.vcard
    )
    return { text: summary, locationLink: null, mediaType: 'contact' }
  }

  if (inner.contactsArrayMessage?.contacts?.length) {
    const lines = inner.contactsArrayMessage.contacts.map((c) =>
      parseVcardSummary(c.displayName, c.vcard)
    )
    return { text: lines.join('\n'), locationLink: null, mediaType: 'contact' }
  }

  // 3. Pedidos del catálogo de WhatsApp Business (orderMessage) y consultas de productos (productMessage)
  if (inner.orderMessage) {
    const orderMsg = inner.orderMessage
    const orderId = String(orderMsg.orderId || '').trim()
    const token = String(orderMsg.token || '').trim()
    const itemCount = Number(orderMsg.itemCount || 0)
    const rawTotal1000 = Number(orderMsg.totalAmount1000 || 0)
    const fallbackTotal = rawTotal1000 > 0 ? rawTotal1000 / 1000 : null
    const note = String(orderMsg.message || '').trim()

    let detailLines: string[] = []
    let detailTotal: number | null = fallbackTotal
    let thumbUrl: string | null = null

    if (orderMsg.thumbnail && orderMsg.thumbnail.length > 0) {
      thumbUrl = `data:image/jpeg;base64,${Buffer.from(orderMsg.thumbnail).toString('base64')}`
    }

    if (orderId && token && session.socket && typeof session.socket.getOrderDetails === 'function') {
      try {
        const details = await session.socket.getOrderDetails(orderId, token)
        if (details?.products?.length) {
          detailLines = details.products.map((p: any) => {
            const qty = Number(p.quantity || 1)
            const unitPrice = Number(p.price || 0) > 0 ? Number(p.price) / 1000 : null
            return `• ${qty}x ${p.name || 'Producto'}${
              unitPrice !== null ? ` ($${unitPrice.toFixed(2)})` : ''
            }`
          })
        }
        if (typeof details?.price?.total === 'number' && details.price.total > 0) {
          detailTotal = details.price.total / 1000
        }
      } catch (err) {
        console.warn('[Baileys] No se pudo obtener getOrderDetails del catálogo:', err)
      }
    }

    const parts: string[] = [
      `🛒 Pedido del catálogo de WhatsApp${itemCount > 0 ? ` (${itemCount} ítem${itemCount === 1 ? '' : 's'})` : ''}:`,
    ]
    if (detailLines.length > 0) {
      parts.push(...detailLines)
    } else if (orderMsg.orderTitle) {
      parts.push(`• ${orderMsg.orderTitle}`)
    }
    if (detailTotal !== null) {
      parts.push(`Total catálogo: $${detailTotal.toFixed(2)}`)
    }
    if (note) {
      parts.push(`Nota: ${note}`)
    }

    return {
      text: parts.join('\n'),
      locationLink: null,
      mediaType: 'order',
      mediaUrl: thumbUrl,
    }
  }

  if (inner.productMessage?.product) {
    const prod = inner.productMessage.product
    const title = String(prod.title || 'Producto del catálogo').trim()
    const rawPrice1000 = Number(prod.priceAmount1000 || 0)
    const price = rawPrice1000 > 0 ? rawPrice1000 / 1000 : null
    const body = String(inner.productMessage.body || prod.description || '').trim()
    const summary = `🏷️ Producto del catálogo: ${title}${
      price !== null ? ` ($${price.toFixed(2)})` : ''
    }${body ? `\n${body}` : ''}`
    return {
      text: summary,
      locationLink: null,
      mediaType: 'order',
    }
  }

  // 4. Imágenes (ej. comprobantes de transferencia bancaria, fotos de productos/referencias)
  if (inner.imageMessage) {
    const imgMsg = inner.imageMessage
    const caption = String(imgMsg.caption || '').trim()
    const msgId = msg.key?.id || `img_${Date.now()}`
    let mediaUrl: string | null = null

    try {
      const { downloadMediaMessage } = await loadBaileys()
      const buffer = (await downloadMediaMessage(
        msg as any,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: session.socket
            ? session.socket.updateMediaMessage
            : (async (m: any) => m),
        }
      )) as Buffer
      if (buffer && buffer.length > 0) {
        mediaUrl = await uploadWhatsAppMediaToStorage({
          businessId: session.businessId,
          fileName: `${msgId}.jpg`,
          buffer,
          contentType: imgMsg.mimetype || 'image/jpeg',
        })
      }
    } catch (err) {
      console.warn('[Baileys] Error descargando imagen, usando miniatura de respaldo:', err)
    }

    if (!mediaUrl && imgMsg.jpegThumbnail && imgMsg.jpegThumbnail.length > 0) {
      mediaUrl = `data:image/jpeg;base64,${Buffer.from(imgMsg.jpegThumbnail).toString('base64')}`
    }

    const text = caption ? `📷 ${caption}` : '📷 Imagen enviada'
    return {
      text,
      locationLink: caption ? extractLocationLinkFromText(caption) : null,
      mediaUrl,
      mediaType: 'image',
    }
  }

  // 5. Documentos / PDFs (ej. comprobantes de transferencia en PDF)
  if (inner.documentMessage) {
    const docMsg = inner.documentMessage
    const fileName = String(docMsg.fileName || docMsg.title || 'Documento').trim()
    const caption = String(docMsg.caption || '').trim()
    const msgId = msg.key?.id || `doc_${Date.now()}`
    let mediaUrl: string | null = null

    try {
      const { downloadMediaMessage } = await loadBaileys()
      const buffer = (await downloadMediaMessage(
        msg as any,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: session.socket
            ? session.socket.updateMediaMessage
            : (async (m: any) => m),
        }
      )) as Buffer
      if (buffer && buffer.length > 0) {
        mediaUrl = await uploadWhatsAppMediaToStorage({
          businessId: session.businessId,
          fileName: `${msgId}_${fileName}`,
          buffer,
          contentType: docMsg.mimetype || 'application/octet-stream',
        })
      }
    } catch (err) {
      console.warn('[Baileys] Error descargando documento:', err)
    }

    const text = `📄 ${fileName}${caption ? ` — ${caption}` : ''}`
    return {
      text,
      locationLink: null,
      mediaUrl,
      mediaType: 'document',
      fileName,
    }
  }

  // 6. Notas de voz / Audios
  if (inner.audioMessage) {
    const secs = Number(inner.audioMessage.seconds || 0)
    const msgId = msg.key?.id || `aud_${Date.now()}`
    let mediaUrl: string | null = null

    try {
      const { downloadMediaMessage } = await loadBaileys()
      const buffer = (await downloadMediaMessage(
        msg as any,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: session.socket
            ? session.socket.updateMediaMessage
            : (async (m: any) => m),
        }
      )) as Buffer
      if (buffer && buffer.length > 0) {
        mediaUrl = await uploadWhatsAppMediaToStorage({
          businessId: session.businessId,
          fileName: `${msgId}.ogg`,
          buffer,
          contentType: inner.audioMessage.mimetype || 'audio/ogg',
        })
      }
    } catch {
      // Ignorar fallo en audio
    }

    return {
      text: `🎤 Nota de voz${secs > 0 ? ` (${secs}s)` : ''}`,
      locationLink: null,
      mediaUrl,
      mediaType: 'audio',
    }
  }

  // 7. Videos y Stickers
  if (inner.videoMessage) {
    const caption = String(inner.videoMessage.caption || '').trim()
    return {
      text: caption ? `🎥 ${caption}` : '🎥 Video enviado',
      locationLink: caption ? extractLocationLinkFromText(caption) : null,
    }
  }

  if (inner.stickerMessage) {
    return {
      text: '💟 Envió un sticker.',
      locationLink: null,
    }
  }

  // 8. Texto normal y respuestas a botones/listas
  const text = (
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.buttonsResponseMessage?.selectedDisplayText ||
    inner.listResponseMessage?.title ||
    inner.templateButtonReplyMessage?.selectedDisplayText ||
    ''
  ).trim()

  return {
    text,
    locationLink: text ? extractLocationLinkFromText(text) : null,
  }
}

function isSameLocalDay(millisA: number, millisB: number): boolean {
  const a = new Date(millisA)
  const b = new Date(millisB)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * AuthState de Baileys respaldado 100% en Firestore (compatible con Vercel Serverless,
 * donde /var/task es de solo lectura).
 */
async function useFirestoreAuthState(businessId: string): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
  clearState: () => Promise<void>
  hasExistingCreds: boolean
}> {
  const { BufferJSON, initAuthCreds } = await loadBaileys()
  const db = ensureAdminDb()
  if (!db) {
    throw new Error('Firebase Admin no está disponible para guardar la sesión de WhatsApp')
  }

  const colRef = db.collection('businesses').doc(businessId).collection('whatsappAuth')
  const credsDocRef = colRef.doc('creds')
  const keyCache = new Map<string, any>()

  const safeDocId = (type: string, id: string) =>
    `key_${type}_${id}`.replace(/[^a-zA-Z0-9_.-]/g, '_')

  let creds: AuthenticationCreds
  let hasExistingCreds = false

  try {
    const snap = await credsDocRef.get()
    if (snap.exists && snap.data()?.json) {
      creds = JSON.parse(String(snap.data()!.json), BufferJSON.reviver)
      hasExistingCreds = Boolean(creds?.registered)
    } else {
      creds = initAuthCreds()
    }
  } catch {
    creds = initAuthCreds()
  }

  const saveCreds = async () => {
    try {
      await credsDocRef.set(
        {
          json: JSON.stringify(creds, BufferJSON.replacer),
          updatedAtMillis: Date.now(),
        },
        { merge: true }
      )
    } catch (err) {
      console.warn('[Baileys FirestoreAuth] Error guardando creds:', err)
    }
  }

  const clearState = async () => {
    keyCache.clear()
    try {
      const snap = await colRef.limit(400).get()
      if (!snap.empty) {
        const batch = db.batch()
        snap.docs.forEach((d) => batch.delete(d.ref))
        await batch.commit()
      }
    } catch (err) {
      console.warn('[Baileys FirestoreAuth] Error limpiando sesión:', err)
    }
  }

  return {
    hasExistingCreds,
    saveCreds,
    clearState,
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {}
          const missingIds: string[] = []

          for (const id of ids) {
            const cacheKey = `${type}:${id}`
            if (keyCache.has(cacheKey)) {
              const cached = keyCache.get(cacheKey)
              if (cached !== null && cached !== undefined) {
                data[id] = cached
              }
            } else {
              missingIds.push(id)
            }
          }

          if (missingIds.length > 0) {
            await Promise.all(
              missingIds.map(async (id) => {
                const cacheKey = `${type}:${id}`
                try {
                  const snap = await colRef.doc(safeDocId(String(type), id)).get()
                  if (snap.exists && snap.data()?.json) {
                    const parsed = JSON.parse(String(snap.data()!.json), BufferJSON.reviver)
                    keyCache.set(cacheKey, parsed)
                    data[id] = parsed
                  } else {
                    keyCache.set(cacheKey, null)
                  }
                } catch {
                  // Ignorar error individual de lectura
                }
              })
            )
          }

          return data
        },
        set: async (data: any) => {
          const batch = db.batch()
          let ops = 0

          for (const category in data) {
            const catData = data[category]
            if (!catData) continue
            for (const id in catData) {
              const value = catData[id]
              const cacheKey = `${category}:${id}`
              const docRef = colRef.doc(safeDocId(category, id))
              if (value) {
                keyCache.set(cacheKey, value)
                batch.set(docRef, {
                  json: JSON.stringify(value, BufferJSON.replacer),
                  updatedAtMillis: Date.now(),
                })
                ops++
              } else {
                keyCache.set(cacheKey, null)
                batch.delete(docRef)
                ops++
              }
            }
          }

          if (ops > 0) {
            try {
              await batch.commit()
            } catch (err) {
              console.warn('[Baileys FirestoreAuth] Error guardando keys batch:', err)
            }
          }
        },
      },
    },
  }
}

class WhatsAppBaileysManager {
  private sessions = new Map<string, ManagedSession>()
  private logger = pino({ level: 'silent' })

  private getOrCreateSession(businessId: string): ManagedSession {
    let session = this.sessions.get(businessId)
    if (!session) {
      session = {
        businessId,
        socket: null,
        state: {
          businessId,
          status: 'disconnected',
          qrDataUrl: null,
          pairingCode: null,
          connectedPhone: null,
          connectedName: null,
          lastError: null,
          updatedAtMillis: Date.now(),
        },
        firestoreUnsub: null,
        excludedUnsub: null,
        excludedPhones: new Set(),
        processedReplyIds: new Set(),
        sentByBridgeMsgIds: new Set(),
        reconnectTimer: null,
        isConnecting: false,
        manualDisconnect: false,
        stateWaiters: [],
      }
      this.sessions.set(businessId, session)
    }
    return session
  }

  private notifyStateWaiters(session: ManagedSession) {
    const waiters = session.stateWaiters.splice(0, session.stateWaiters.length)
    waiters.forEach((fn) => {
      try {
        fn()
      } catch {
        // Ignorar
      }
    })
  }

  private waitForStateChange(session: ManagedSession, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      session.stateWaiters.push(() => {
        clearTimeout(timer)
        finish()
      })
    })
  }

  public async getStateAsync(businessId: string, holdMs = 0): Promise<BaileysBusinessState> {
    const session = this.getOrCreateSession(businessId)
    const db = ensureAdminDb()

    // Si en memoria está desconectado, revisar en Firestore si ya había credenciales registradas
    if (
      session.state.status === 'disconnected' &&
      !session.isConnecting &&
      !session.manualDisconnect &&
      db
    ) {
      try {
        const statusSnap = await db
          .collection('businesses')
          .doc(businessId)
          .collection('whatsappConnection')
          .doc('status')
          .get()
        if (statusSnap.exists) {
          const d = statusSnap.data() || {}
          if (d.status === 'connected') {
            // Reconectar en caliente
            await this.connect(businessId, { waitMs: Math.max(holdMs, 6000) })
            return session.state
          }
        }
      } catch {
        // Ignorar
      }
    }

    // En Vercel Serverless, mientras el modal está esperando que el usuario escanee el QR o ingrese el código,
    // mantener viva la petición HTTP unos segundos permite que el WebSocket complete el handshake
    if (
      holdMs > 0 &&
      (session.state.status === 'qr' || session.state.status === 'connecting')
    ) {
      await this.waitForStateChange(session, Math.min(holdMs, 12000))
    }

    return session.state
  }

  private async persistConnectionState(session: ManagedSession) {
    session.state.updatedAtMillis = Date.now()
    this.notifyStateWaiters(session)
    const db = ensureAdminDb()
    if (!db) return
    try {
      await db
        .collection('businesses')
        .doc(session.businessId)
        .collection('whatsappConnection')
        .doc('status')
        .set(
          {
            status: session.state.status,
            qrDataUrl: session.state.qrDataUrl,
            pairingCode: session.state.pairingCode,
            connectedPhone: session.state.connectedPhone,
            connectedName: session.state.connectedName,
            lastError: session.state.lastError,
            updatedAtMillis: session.state.updatedAtMillis,
            mode: 'baileys',
          },
          { merge: true }
        )
    } catch (err) {
      console.warn('[Baileys] Error guardando estado en Firestore:', err)
    }
  }

  private setupFirestoreListeners(session: ManagedSession) {
    const db = ensureAdminDb()
    if (!db) return

    if (!session.excludedUnsub) {
      session.excludedUnsub = db
        .collection('businesses')
        .doc(session.businessId)
        .collection('whatsappExcluded')
        .onSnapshot(
          (snap) => {
            const next = new Set<string>()
            snap.docs.forEach((d) => {
              const data = d.data() || {}
              const norm = normalizeEcuadorPhone(data.phone)
              if (norm.length >= 9) next.add(norm)
            })
            session.excludedPhones = next
          },
          (err) => console.warn('[Baileys] Error escuchando whatsappExcluded:', err)
        )
    }

    if (!session.firestoreUnsub) {
      session.firestoreUnsub = db
        .collection('businesses')
        .doc(session.businessId)
        .collection('whatsappPending')
        .onSnapshot(
          (snap) => {
            if (session.state.status !== 'connected' || !session.socket) return
            snap.docs.forEach((docSnap) => {
              const data = docSnap.data() || {}
              const pendingReply = data.pendingReply
              if (
                pendingReply &&
                pendingReply.status === 'pending' &&
                pendingReply.id &&
                pendingReply.text &&
                !session.processedReplyIds.has(pendingReply.id)
              ) {
                session.processedReplyIds.add(pendingReply.id)
                const phone = data.phone || data.rawPhone || ''
                void this.sendOutgoingMessage(
                  session.businessId,
                  docSnap.id,
                  phone,
                  String(pendingReply.text),
                  String(pendingReply.id)
                )
              }
            })
          },
          (err) => console.warn('[Baileys] Error escuchando whatsappPending:', err)
        )
    }
  }

  public async connect(
    businessId: string,
    options?: { pairingPhone?: string; waitMs?: number }
  ): Promise<BaileysBusinessState> {
    const session = this.getOrCreateSession(businessId)
    session.manualDisconnect = false
    const pairingPhone = options?.pairingPhone?.trim() || ''
    const waitMs = typeof options?.waitMs === 'number' ? options.waitMs : 12000

    // Si ya está conectado, devolver directo
    if (session.state.status === 'connected' && session.socket) {
      return session.state
    }

    // Si ya está en estado QR y ahora pidió código de emparejamiento por teléfono sobre el mismo socket activo
    if (pairingPhone && session.socket && session.state.status === 'qr') {
      const intlPhone = ecuadorPhoneToIntlDigits(pairingPhone)
      if (!intlPhone) {
        session.state.lastError = 'Ingresa un número celular válido (ej. 0991234567)'
        await this.persistConnectionState(session)
        return session.state
      }
      try {
        const code = await session.socket.requestPairingCode(intlPhone)
        session.state.pairingCode = code
        session.state.lastError = null
        await this.persistConnectionState(session)
      } catch (err: any) {
        session.state.lastError = err?.message || 'No se pudo generar el código de vinculación'
        await this.persistConnectionState(session)
      }
      return session.state
    }

    if (session.isConnecting) {
      if (waitMs > 0) {
        await this.waitForStateChange(session, waitMs)
      }
      return session.state
    }

    session.isConnecting = true
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer)
      session.reconnectTimer = null
    }

    session.state.status = 'connecting'
    session.state.lastError = null
    if (!pairingPhone) {
      session.state.pairingCode = null
    }
    await this.persistConnectionState(session)

    try {
      const baileys = await loadBaileys()
      const makeWASocket = baileys.makeWASocket || baileys.default
      const { DisconnectReason, fetchLatestBaileysVersion } = baileys
      const { state, saveCreds, clearState } = await useFirestoreAuthState(businessId)
      let version: [number, number, number] = [2, 3000, 1017531287]
      try {
        const latest = await fetchLatestBaileysVersion()
        if (latest?.version) version = latest.version
      } catch {
        // Usar versión por defecto
      }

      const sock = makeWASocket({
        version,
        auth: state,
        logger: this.logger as any,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
      })

      session.socket = sock
      this.setupFirestoreListeners(session)

      sock.ev.on('creds.update', saveCreds)

      let pairingRequestedForSocket = false

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          session.isConnecting = false
          try {
            const qrDataUrl = await QRCode.toDataURL(qr, {
              margin: 2,
              width: 280,
              color: { dark: '#0f172a', light: '#ffffff' },
            })
            session.state.status = 'qr'
            session.state.qrDataUrl = qrDataUrl

            // Si solicitó vincular por número de teléfono, pedir el código de 8 caracteres
            if (pairingPhone && !pairingRequestedForSocket && !sock.authState.creds.registered) {
              pairingRequestedForSocket = true
              const intlPhone = ecuadorPhoneToIntlDigits(pairingPhone)
              if (intlPhone) {
                try {
                  const code = await sock.requestPairingCode(intlPhone)
                  session.state.pairingCode = code
                } catch (pairErr: any) {
                  console.warn('[Baileys] Error solicitando pairingCode:', pairErr)
                  session.state.lastError =
                    pairErr?.message || 'No se pudo obtener el código por número'
                }
              }
            }

            await this.persistConnectionState(session)
          } catch (qrErr) {
            console.error('[Baileys] Error generando QR DataURL:', qrErr)
          }
        }

        if (connection === 'open') {
          session.isConnecting = false
          const meJid = sock.user?.id || ''
          const rawMePhone = meJid.split(':')[0]?.split('@')[0] || ''
          session.state.status = 'connected'
          session.state.qrDataUrl = null
          session.state.pairingCode = null
          session.state.connectedPhone = normalizeEcuadorPhone(rawMePhone) || rawMePhone || null
          session.state.connectedName = sock.user?.name || null
          session.state.lastError = null
          await this.persistConnectionState(session)
          await this.markAllConversationsDirectReplyReady(businessId, true)
        }

        if (connection === 'close') {
          session.isConnecting = false
          session.socket = null
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
          const loggedOut = statusCode === DisconnectReason.loggedOut

          if (loggedOut) {
            await clearState()
            session.state.status = 'disconnected'
            session.state.qrDataUrl = null
            session.state.pairingCode = null
            session.state.connectedPhone = null
            session.state.connectedName = null
            session.state.lastError = 'Sesión cerrada desde el teléfono'
            await this.persistConnectionState(session)
          } else if (!session.manualDisconnect) {
            session.state.status = 'connecting'
            await this.persistConnectionState(session)
            session.reconnectTimer = setTimeout(() => {
              void this.connect(businessId, { waitMs: 0 })
            }, 2500)
          } else {
            session.state.status = 'disconnected'
            session.state.qrDataUrl = null
            session.state.pairingCode = null
            await this.persistConnectionState(session)
          }
        }
      })

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify' && type !== 'append') return
        for (const msg of messages) {
          try {
            await this.handleUpsertedMessage(session, msg)
          } catch (err) {
            console.warn('[Baileys] Error procesando mensaje:', err)
          }
        }
      })

      // Esperar hasta que Baileys emita el primer QR, el pairingCode o abra la conexión
      if (waitMs > 0 && session.state.status === 'connecting') {
        await this.waitForStateChange(session, waitMs)
      }
    } catch (err: any) {
      session.isConnecting = false
      session.state.status = 'disconnected'
      session.state.lastError = err?.message || 'Error al iniciar conexión de WhatsApp'
      await this.persistConnectionState(session)
    }

    return session.state
  }

  public async disconnect(businessId: string, logout = true): Promise<BaileysBusinessState> {
    const session = this.getOrCreateSession(businessId)
    session.manualDisconnect = true
    session.isConnecting = false

    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer)
      session.reconnectTimer = null
    }

    try {
      if (logout && session.socket) {
        await session.socket.logout()
      } else if (session.socket) {
        session.socket.end(undefined)
      }
    } catch {
      // Ignorar errores al cerrar socket
    }

    session.socket = null
    if (logout) {
      try {
        const { clearState } = await useFirestoreAuthState(businessId)
        await clearState()
      } catch {
        // Ignorar
      }
    }

    session.state.status = 'disconnected'
    session.state.qrDataUrl = null
    session.state.pairingCode = null
    session.state.connectedPhone = null
    session.state.connectedName = null
    await this.persistConnectionState(session)
    return session.state
  }

  private async markAllConversationsDirectReplyReady(businessId: string, ready: boolean) {
    const db = ensureAdminDb()
    if (!db) return
    try {
      const snap = await db
        .collection('businesses')
        .doc(businessId)
        .collection('whatsappPending')
        .where('status', 'in', ['pending', 'confirmed'])
        .limit(50)
        .get()
      const batch = db.batch()
      snap.docs.forEach((d) => {
        batch.set(d.ref, { canReplyDirectly: ready }, { merge: true })
      })
      await batch.commit()
    } catch {
      // Ignorar
    }
  }

  private async lookupClientByPhone(normPhone: string): Promise<{
    id: string
    nombres: string
    email: string
    notas: string
  } | null> {
    const db = ensureAdminDb()
    if (!db || normPhone.length < 9) return null
    try {
      const candidates = Array.from(
        new Set([
          normPhone,
          normPhone.startsWith('0') ? `+593${normPhone.slice(1)}` : normPhone,
          normPhone.startsWith('0') ? `593${normPhone.slice(1)}` : normPhone,
        ])
      )
      for (const candidate of candidates) {
        const snap = await db
          .collection('clients')
          .where('celular', '==', candidate)
          .limit(1)
          .get()
        if (!snap.empty) {
          const doc = snap.docs[0]
          const d = doc.data() || {}
          return {
            id: doc.id,
            nombres: String(d.nombres || '').trim(),
            email: String(d.email || '').trim(),
            notas: String(d.notas || '').trim(),
          }
        }
      }
    } catch {
      // Ignorar
    }
    return null
  }

  private async handleUpsertedMessage(session: ManagedSession, msg: proto.IWebMessageInfo) {
    const remoteJid = msg.key?.remoteJid || ''
    if (
      !remoteJid ||
      remoteJid === 'status@broadcast' ||
      remoteJid.endsWith('@g.us') ||
      remoteJid.endsWith('@newsletter') ||
      remoteJid.endsWith('@broadcast')
    ) {
      return
    }

    const isLid = remoteJid.endsWith('@lid')
    const altParticipant = (msg.key as any)?.senderPn || (msg as any)?.senderPn || msg.participant || ''
    const phoneSource = remoteJid.endsWith('@s.whatsapp.net')
      ? remoteJid.split('@')[0]
      : altParticipant.includes('@s.whatsapp.net')
        ? altParticipant.split('@')[0]
        : remoteJid.split('@')[0]

    let normPhone = normalizeEcuadorPhone(phoneSource)
    if (normPhone.length < 9) return
    if (session.excludedPhones.has(normPhone)) return

    const { text, locationLink, mediaUrl, mediaType, fileName } =
      await extractRichMessageContent(session, msg, this.logger)
    if (!text) return

    const msgId = msg.key?.id || `msg_${Date.now()}`
    if (session.sentByBridgeMsgIds.has(msgId)) return

    const rawTs = Number(msg.messageTimestamp || 0)
    const msgMillis = rawTs > 0 ? (rawTs < 10_000_000_000 ? rawTs * 1000 : rawTs) : Date.now()
    const fromMe = Boolean(msg.key?.fromMe)

    const db = ensureAdminDb()
    if (!db) return

    const colRef = db
      .collection('businesses')
      .doc(session.businessId)
      .collection('whatsappPending')

    const pushName = String(msg.pushName || '').trim()

    // Resolver el documento existente en whatsappPending (unificando con el formato phone:09... de Android o con whatsappJid)
    let docId = `phone:${normPhone}`
    let existing: Record<string, any> | null = null

    const colonSnap = await colRef.doc(`phone:${normPhone}`).get()
    if (colonSnap.exists) {
      docId = colonSnap.id
      existing = colonSnap.data() || {}
    } else {
      const underscoreSnap = await colRef.doc(`phone_${normPhone}`).get()
      if (underscoreSnap.exists) {
        docId = underscoreSnap.id
        existing = underscoreSnap.data() || {}
      } else if (isLid) {
        // Si entró con @lid, buscar si ya existe una conversación por whatsappJid o con el mismo nombre de contacto en Android
        const recentSnap = await colRef.orderBy('timestampMillis', 'desc').limit(30).get()
        const cleanPush = pushName.toLowerCase()
        const matchedDoc = recentSnap.docs.find((d) => {
          const data = d.data() || {}
          if (data.whatsappJid === remoteJid) return true
          if (
            cleanPush.length >= 2 &&
            (String(data.displayName || '').trim().toLowerCase() === cleanPush ||
              String(data.fuddiClientName || '').trim().toLowerCase() === cleanPush)
          ) {
            return true
          }
          return false
        })
        if (matchedDoc) {
          docId = matchedDoc.id
          existing = matchedDoc.data() || {}
          const existingPhone = normalizeEcuadorPhone(existing.phone || existing.rawPhone)
          if (existingPhone.length >= 9 && !isWhatsAppLidDigits(existingPhone)) {
            normPhone = existingPhone
          }
        }
      }
    }

    const convId = existing?.id || `phone:${normPhone}`
    const docRef = colRef.doc(docId)

    if (fromMe) {
      if (!existing) return
      const currentReplies: any[] = Array.isArray(existing.sentReplies) ? existing.sentReplies : []
      if (currentReplies.some((r) => r?.id === msgId || r?.text === text)) return
      const nextReplies = [
        ...currentReplies,
        {
          id: msgId,
          text,
          timestampMillis: msgMillis,
          source: 'whatsapp',
        },
      ].slice(-MAX_RECENT_MESSAGES)
      const currentHistory: any[] = Array.isArray(existing.chatHistory) ? existing.chatHistory : []
      const nextHistory = [
        ...currentHistory,
        {
          id: msgId,
          text,
          timestampMillis: msgMillis,
          fromMe: true,
          source: 'whatsapp',
          ...(mediaUrl ? { mediaUrl } : {}),
          ...(mediaType ? { mediaType } : {}),
          ...(fileName ? { fileName } : {}),
        },
      ].slice(-MAX_CHAT_HISTORY)
      await docRef.set(
        {
          whatsappJid: remoteJid,
          sentReplies: nextReplies,
          chatHistory: nextHistory,
          canReplyDirectly: true,
        },
        { merge: true }
      )
      return
    }
    const prevRecent: string[] = Array.isArray(existing?.recentMessages)
      ? existing.recentMessages
      : []
    const nextRecent =
      prevRecent[prevRecent.length - 1] === text
        ? prevRecent
        : [...prevRecent, text].slice(-MAX_RECENT_MESSAGES)

    let fuddiClientId = String(existing?.fuddiClientId || '').trim()
    let fuddiClientName = String(existing?.fuddiClientName || '').trim()
    let fuddiClientEmail = String(existing?.fuddiClientEmail || '').trim()
    let fuddiClientNotes = String(existing?.fuddiClientNotes || '').trim()
    let isRegisteredClient = Boolean(existing?.isRegisteredClient && fuddiClientId)

    if (!fuddiClientId) {
      const client = await this.lookupClientByPhone(normPhone)
      if (client) {
        fuddiClientId = client.id
        fuddiClientName = client.nombres || fuddiClientName
        fuddiClientEmail = client.email || fuddiClientEmail
        fuddiClientNotes = client.notas || fuddiClientNotes
        isRegisteredClient = true
      }
    }

    const displayName = fuddiClientName || pushName || String(existing?.displayName || '').trim()
    const effectiveName = displayName || `Cliente (${normPhone})`
    const prevStatus = existing?.status || 'pending'
    const nowMillis = Date.now()

    let nextStatus: 'pending' | 'confirmed' | 'closed' = 'pending'
    let reopenedAtMillis: number | null = existing?.reopenedAtMillis || null
    let closedAtMillis: number | null = existing?.closedAtMillis || null
    let resolvedAtMillis: number | null = existing?.resolvedAtMillis || null

    if (
      prevStatus === 'confirmed' &&
      existing?.confirmedAtMillis &&
      isSameLocalDay(Number(existing.confirmedAtMillis), nowMillis)
    ) {
      nextStatus = 'confirmed'
    } else if (prevStatus === 'closed') {
      nextStatus = 'pending'
      reopenedAtMillis = Math.max(nowMillis, msgMillis)
      closedAtMillis = null
      resolvedAtMillis = null
    }

    const prevUnread = typeof existing?.unreadCount === 'number' ? existing.unreadCount : 0
    const prevHistory: any[] = Array.isArray(existing?.chatHistory) ? existing.chatHistory : []
    const nextHistory = [
      ...prevHistory.filter((h) => h?.id !== msgId),
      {
        id: msgId,
        text,
        timestampMillis: Math.max(nowMillis, msgMillis),
        fromMe: false,
        source: 'baileys',
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(mediaType ? { mediaType } : {}),
        ...(fileName ? { fileName } : {}),
      },
    ].slice(-MAX_CHAT_HISTORY)

    await docRef.set(
      {
        id: convId,
        whatsappJid: remoteJid,
        phone: normPhone,
        rawPhone: normPhone,
        displayName,
        effectiveName,
        fuddiClientId,
        fuddiClientName,
        fuddiClientEmail,
        fuddiClientNotes,
        isRegisteredClient,
        lastMessage: text,
        recentMessages: nextRecent,
        chatHistory: nextHistory,
        detectedLocationLink: locationLink || existing?.detectedLocationLink || null,
        timestampMillis: Math.max(nowMillis, msgMillis),
        unreadCount: prevUnread + 1,
        sourcePackage: 'baileys',
        canReplyDirectly: true,
        status: nextStatus,
        reopenedAtMillis,
        closedAtMillis,
        resolvedAtMillis,
      },
      { merge: true }
    )
  }

  public async sendOutgoingMessage(
    businessId: string,
    docId: string,
    phone: string,
    text: string,
    replyId = `baileys_${Date.now()}`
  ): Promise<{ ok: boolean; error?: string }> {
    const cleanText = text.trim()
    if (!cleanText) return { ok: false, error: 'Mensaje vacío' }

    const session = this.getOrCreateSession(businessId)

    // Si la instancia Serverless de Vercel estaba fría pero hay credenciales guardadas en Firestore, reconectar al vuelo
    if (session.state.status !== 'connected' || !session.socket) {
      try {
        const { hasExistingCreds } = await useFirestoreAuthState(businessId)
        if (hasExistingCreds) {
          await this.connect(businessId, { waitMs: 8000 })
        }
      } catch {
        // Ignorar
      }
    }

    if (session.state.status !== 'connected' || !session.socket) {
      return { ok: false, error: 'WhatsApp no está conectado como dispositivo vinculado' }
    }

    const db = ensureAdminDb()
    let docRef: FirebaseFirestore.DocumentReference | null = null
    let existingDocData: Record<string, any> = {}

    if (db && docId) {
      docRef = db
        .collection('businesses')
        .doc(businessId)
        .collection('whatsappPending')
        .doc(docId)
      try {
        const snap = await docRef.get()
        if (snap.exists) {
          existingDocData = snap.data() || {}
        }
      } catch {
        // Ignorar
      }
    }

    const jid = ecuadorPhoneToJid(
      phone || existingDocData.phone || existingDocData.rawPhone || '',
      existingDocData.whatsappJid
    )
    if (!jid) return { ok: false, error: 'Número o JID de WhatsApp inválido' }

    try {
      session.processedReplyIds.add(replyId)
      const sentMsg = await session.socket.sendMessage(jid, { text: cleanText })
      if (sentMsg?.key?.id) {
        session.sentByBridgeMsgIds.add(sentMsg.key.id)
      }

      if (docRef) {
        const currentReplies: any[] = Array.isArray(existingDocData.sentReplies)
          ? existingDocData.sentReplies
          : []
        const nowOut = Date.now()
        const nextReplies = [
          ...currentReplies.filter((r) => r?.id !== replyId),
          {
            id: replyId,
            text: cleanText,
            timestampMillis: nowOut,
            source: 'baileys',
          },
        ].slice(-MAX_RECENT_MESSAGES)

        const currentHistory: any[] = Array.isArray(existingDocData.chatHistory)
          ? existingDocData.chatHistory
          : []
        const nextHistory = [
          ...currentHistory.filter((h) => h?.id !== replyId),
          {
            id: replyId,
            text: cleanText,
            timestampMillis: nowOut,
            fromMe: true,
            source: 'baileys',
          },
        ].slice(-MAX_CHAT_HISTORY)

        await docRef.set(
          {
            whatsappJid: jid,
            sentReplies: nextReplies,
            chatHistory: nextHistory,
            pendingReply: null,
            canReplyDirectly: true,
          },
          { merge: true }
        )
      }

      return { ok: true }
    } catch (err: any) {
      console.error('[Baileys] Error enviando mensaje:', err)
      return { ok: false, error: err?.message || 'Error al enviar mensaje por Baileys' }
    }
  }
}

const globalForBaileys = globalThis as unknown as {
  __fuddiBaileysManager?: WhatsAppBaileysManager
}

export function getWhatsAppBaileysManager(): WhatsAppBaileysManager {
  if (!globalForBaileys.__fuddiBaileysManager) {
    globalForBaileys.__fuddiBaileysManager = new WhatsAppBaileysManager()
  }
  return globalForBaileys.__fuddiBaileysManager
}
