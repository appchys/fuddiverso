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
import {
  extractFirstUrlFromText,
  fetchLinkPreviewMetadata,
  fetchLinkPreviewJpegThumbnail,
  type LinkPreviewData,
} from '@/lib/link-preview'

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
  baileysHistoryByDoc: Map<string, any[]>
  repairingDocIds: Set<string>
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempts: number
  outgoingSendTimestamps: number[]
  isConnecting: boolean
  manualDisconnect: boolean
  stateWaiters: Array<() => void>
}

const MAX_RECENT_MESSAGES = 8
const MAX_CHAT_HISTORY = 24
const MAX_OUTGOING_PER_MINUTE = 25
const MAX_OUTGOING_TEXT_LENGTH = 4000

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

const WA_CATALOG_GRAPHQL_URL = 'https://graph.whatsapp.com/graphql/catalog'
const WA_CATALOG_PUBLIC_TOKEN = 'WA|787118555984857|7bb1544a3599aa180ac9a3f7688ba243'
const WA_ORDER_INFO_DOC_ID = '26593811266898374'
const WA_PRODUCT_CATALOG_DOC_ID = '30445081048424116'

/**
 * Consulta los productos y el total de un pedido del catálogo de WhatsApp Business.
 * 1) Usa el endpoint HTTPS GraphQL de WhatsApp (`graph.whatsapp.com/graphql/catalog`, doc_id `26593811266898374`),
 *    ya que WhatsApp retiró tanto `fb:thrift_iq` (501) como el envío por socket `w:mex` (400).
 * 2) Si por alguna razón ese endpoint no devuelve líneas, consulta el catálogo público real de la tienda
 *    (`doc_id: 30445081048424116`) y hace coincidencia por precio unitario para identificar el producto.
 */
async function fetchOrderDetailsViaMex(
  session: ManagedSession,
  orderId: string,
  token: string,
  sellerJid?: string | null,
  fallbackItemCount = 0,
  fallbackTotal1000 = 0
): Promise<{
  products: Array<{
    id: string
    name: string
    price: number
    currency: string
    quantity: number
    imageUrl?: string
  }>
  total?: number
} | null> {
  const sock = session.socket
  const rawMe = sock?.user?.id || ''
  const ownPnDigits = rawMe.split(':')[0]?.split('@')[0]?.replace(/\D/g, '') || ''
  const ownPnJid = ownPnDigits ? `${ownPnDigits}@s.whatsapp.net` : ''
  const cleanSellerJid = String(sellerJid || '').trim()
  const targetPnJid =
    ownPnJid ||
    (cleanSellerJid.endsWith('@s.whatsapp.net')
      ? `${cleanSellerJid.split(':')[0].split('@')[0]}@s.whatsapp.net`
      : '')

  if (!targetPnJid) return null

  // 1. Consulta exacta del pedido (xwa_checkout_get_order_info) vía HTTPS GraphQL
  if (orderId && token) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 7000)
      try {
        const res = await fetch(WA_CATALOG_GRAPHQL_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            access_token: WA_CATALOG_PUBLIC_TOKEN,
            doc_id: WA_ORDER_INFO_DOC_ID,
            lang: 'es_ES',
            variables: {
              request: {
                order: {
                  id: orderId,
                  jid: targetPnJid,
                  token: { sensitive_string_value: token },
                  image_dimensions: { width: 100, height: 100 },
                  direct_connection_encrypted_info: null,
                },
              },
            },
          }),
        })
        if (res.ok) {
          const parsed = await res.json()
          const root = parsed?.data?.xwa_checkout_get_order_info
          const orderInfo = root?.order || root
          const rawProducts = Array.isArray(orderInfo?.products) ? orderInfo.products : []
          if (rawProducts.length > 0) {
            const products = rawProducts.map((p: any) => {
              const images = Array.isArray(p?.media?.images) ? p.media.images : []
              return {
                id: String(p?.id || ''),
                name: String(p?.name || p?.title || 'Producto').trim(),
                price: Number(p?.price || p?.price_amount_1000 || 0),
                currency: String(p?.currency || 'USD'),
                quantity: Number(p?.quantity || 1),
                imageUrl:
                  typeof images[0]?.request_image_url === 'string'
                    ? images[0].request_image_url
                    : undefined,
              }
            })
            const rawTotal = Number(orderInfo?.price_details?.total_amount || 0)
            return {
              products,
              total: rawTotal > 0 ? rawTotal : undefined,
            }
          }
        }
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      console.warn('[Baileys GraphQL] Error consultando xwa_checkout_get_order_info:', err)
    }
  }

  // 2. Respaldo: consultar catálogo real de la tienda (xwa_product_catalog_get_product_catalog) y emparejar por precio
  if (fallbackTotal1000 > 0) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 7000)
      try {
        const res = await fetch(WA_CATALOG_GRAPHQL_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            access_token: WA_CATALOG_PUBLIC_TOKEN,
            doc_id: WA_PRODUCT_CATALOG_DOC_ID,
            lang: 'es_ES',
            variables: {
              request: {
                product_catalog: {
                  jid: targetPnJid,
                  allow_shop_source: 'ALLOWSHOPSOURCE_TRUE',
                  width: '100',
                  height: '100',
                  limit: '50',
                  after: null,
                  catalog_session_id: null,
                  direct_connection_encrypted_info: null,
                  variant_info_fields: null,
                  variant_thumbnail_height: null,
                  variant_thumbnail_width: null,
                },
              },
            },
          }),
        })
        if (res.ok) {
          const parsed = await res.json()
          const catalogProducts =
            parsed?.data?.xwa_product_catalog_get_product_catalog?.product_catalog?.products || []
          if (Array.isArray(catalogProducts) && catalogProducts.length > 0) {
            const qty = fallbackItemCount > 0 ? fallbackItemCount : 1
            const unit1000 = Math.round(fallbackTotal1000 / qty)
            const matched = catalogProducts.find((p: any) => {
              const pPrice = Number(p?.sale_price || p?.price || 0)
              return pPrice > 0 && Math.abs(pPrice - unit1000) <= 10
            })
            if (matched) {
              const images = Array.isArray(matched?.media?.images) ? matched.media.images : []
              return {
                products: [
                  {
                    id: String(matched.id || ''),
                    name: String(matched.name || 'Producto').trim(),
                    price: Number(matched.sale_price || matched.price || unit1000),
                    currency: String(matched.currency || 'USD'),
                    quantity: qty,
                    imageUrl:
                      typeof images[0]?.request_image_url === 'string'
                        ? images[0].request_image_url
                        : undefined,
                  },
                ],
                total: fallbackTotal1000,
              }
            }
          }
        }
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      console.warn('[Baileys GraphQL] Error consultando catálogo público:', err)
    }
  }

  return null
}

/**
 * Determina si un mensaje proveniente de la notificación de Android (`in_...` / `source: 'notification'`)
 * es un eco genérico redundante de un mensaje enriquecido ya capturado por Baileys.
 */
function isRedundantAndroidEcho(androidItem: any, baileysItems: any[]): boolean {
  const id = String(androidItem?.id || '')
  const src = String(androidItem?.source || '')
  if (src === 'baileys' || (!id.startsWith('in_') && src !== 'notification')) {
    return false
  }
  const aText = String(androidItem?.text || '').trim()
  const aLower = aText.toLowerCase()
  const aTs = Number(androidItem?.timestampMillis || 0)

  return baileysItems.some((b) => {
    if (Boolean(b?.fromMe) !== Boolean(androidItem?.fromMe)) return false
    const bTs = Number(b?.timestampMillis || 0)
    if (aTs > 0 && bTs > 0 && Math.abs(aTs - bTs) > 60_000) return false
    const bText = String(b?.text || '').trim()
    if (bText.toLowerCase() === aLower) return true
    const bMedia = String(b?.mediaType || '')
    if (
      bMedia === 'order' &&
      (aText.startsWith('🛒') || aLower.includes('solicitud de pedido'))
    ) {
      return true
    }
    if (
      bMedia === 'image' &&
      (aText.startsWith('📷') || aLower.includes('envió una foto'))
    ) {
      return true
    }
    if (
      bMedia === 'audio' &&
      (aText.startsWith('🎤') || aLower.includes('mensaje de voz'))
    ) {
      return true
    }
    if (bMedia === 'document' && aText.startsWith('📄')) {
      return true
    }
    if (bMedia === 'contact' && aText.startsWith('👤')) {
      return true
    }
    if (
      bMedia === 'location' &&
      (aText.startsWith('📍') || aLower.includes('ubicación'))
    ) {
      return true
    }
    return false
  })
}

function recordBaileysHistoryEntry(session: ManagedSession, docId: string, entry: any) {
  const list = session.baileysHistoryByDoc.get(docId) || []
  const filtered = list.filter((x) => x?.id !== entry?.id)
  filtered.push(entry)
  session.baileysHistoryByDoc.set(docId, filtered.slice(-MAX_CHAT_HISTORY))
}

function mergeWithBaileysRichHistory(
  session: ManagedSession,
  docId: string,
  firestoreHistory: any[]
): any[] {
  const cachedBaileys = session.baileysHistoryByDoc.get(docId) || []
  const baseList = Array.isArray(firestoreHistory) ? firestoreHistory : []

  // Unir entradas existentes con las cacheadas por Baileys (priorizando la versión enriquecida con mediaUrl/mediaType)
  const byId = new Map<string, any>()
  for (const item of baseList) {
    if (!item || typeof item !== 'object') continue
    const key = String(item.id || `${item.timestampMillis}_${item.text}`)
    byId.set(key, item)
  }
  for (const bItem of cachedBaileys) {
    if (!bItem || typeof bItem !== 'object') continue
    const key = String(bItem.id || `${bItem.timestampMillis}_${bItem.text}`)
    const existing = byId.get(key)
    if (!existing) {
      byId.set(key, bItem)
    } else {
      byId.set(key, {
        ...existing,
        ...bItem,
        text:
          String(bItem.text || '').length >= String(existing.text || '').length
            ? bItem.text
            : existing.text,
      })
    }
  }

  const allItems = Array.from(byId.values())
  const allBaileysItems = allItems.filter((x) => x?.source === 'baileys')

  return allItems
    .filter((item) => !isRedundantAndroidEcho(item, allBaileysItems))
    .sort((a, b) => Number(a?.timestampMillis || 0) - Number(b?.timestampMillis || 0))
    .slice(-MAX_CHAT_HISTORY)
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

    // 3a. Consultar detalles del pedido vía GraphQL HTTPS de WhatsApp (con respaldo por catálogo de tienda)
    if (session.socket) {
      const mexDetails = await fetchOrderDetailsViaMex(
        session,
        orderId,
        token,
        orderMsg.sellerJid,
        itemCount,
        rawTotal1000
      )
      if (mexDetails?.products?.length) {
        detailLines = mexDetails.products.map((p) => {
          const qty = Number(p.quantity || 1)
          const unitPrice = Number(p.price || 0) > 0 ? Number(p.price) / 1000 : null
          return `• ${qty}x ${p.name || 'Producto'}${
            unitPrice !== null ? ` ($${unitPrice.toFixed(2)})` : ''
          }`
        })
        if (!thumbUrl && mexDetails.products[0]?.imageUrl) {
          thumbUrl = mexDetails.products[0].imageUrl
        }
      }
      if (typeof mexDetails?.total === 'number' && mexDetails.total > 0) {
        detailTotal = mexDetails.total / 1000
      }
    }

    // 3b. Respaldo legacy getOrderDetails si MEX no devolvió líneas
    if (
      detailLines.length === 0 &&
      orderId &&
      token &&
      session.socket &&
      typeof session.socket.getOrderDetails === 'function'
    ) {
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
      } catch {
        // Ignorar fallo en endpoint legacy (501 feature-not-implemented)
      }
    }

    const parts: string[] = [
      `🛒 Pedido del catálogo de WhatsApp${itemCount > 0 ? ` (${itemCount} ítem${itemCount === 1 ? '' : 's'})` : ''}:`,
    ]
    if (detailLines.length > 0) {
      parts.push(...detailLines)
    } else if (orderMsg.orderTitle) {
      const storeName = String(session.state.connectedName || '').trim().toLowerCase()
      const cleanTitle = String(orderMsg.orderTitle).trim()
      if (cleanTitle && cleanTitle.toLowerCase() !== storeName) {
        parts.push(`• ${cleanTitle}`)
      }
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

  const legacySafeDocId = (type: string, id: string) =>
    `key_${type}_${id}`.replace(/[^a-zA-Z0-9_.-]/g, '_')

  const safeDocId = (type: string, id: string) => {
    if (/^[a-zA-Z0-9.-]+$/.test(id) && /^[a-zA-Z0-9-]+$/.test(type)) {
      return `key_${type}_${id}`
    }
    const safeType = String(type).replace(/[^a-zA-Z0-9_.-]/g, '_')
    const encodedId = Buffer.from(String(id), 'utf8').toString('base64url')
    return `key2_${safeType}_${encodedId}`
  }

  let creds: AuthenticationCreds
  let hasExistingCreds = false

  try {
    const snap = await credsDocRef.get()
    if (snap.exists && snap.data()?.json) {
      creds = JSON.parse(String(snap.data()!.json), BufferJSON.reviver)
      hasExistingCreds = Boolean(creds?.registered || creds?.me?.id || creds?.account)
    } else {
      creds = initAuthCreds()
    }
  } catch {
    creds = initAuthCreds()
  }

  let credsSaveChain: Promise<void> = Promise.resolve()
  const saveCreds = async () => {
    const serialized = JSON.stringify(creds, BufferJSON.replacer)
    credsSaveChain = credsSaveChain
      .catch(() => {})
      .then(async () => {
        try {
          await credsDocRef.set(
            {
              json: serialized,
              updatedAtMillis: Date.now(),
            },
            { merge: true }
          )
        } catch (err) {
          console.warn('[Baileys FirestoreAuth] Error guardando creds:', err)
        }
      })
    return credsSaveChain
  }

  const clearState = async () => {
    keyCache.clear()
    try {
      while (true) {
        const snap = await colRef.limit(400).get()
        if (snap.empty) break
        const batch = db.batch()
        snap.docs.forEach((d) => batch.delete(d.ref))
        await batch.commit()
        if (snap.size < 400) break
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
          const typeStr = String(type)

          for (const id of ids) {
            const cacheKey = `${typeStr}:${id}`
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
                const cacheKey = `${typeStr}:${id}`
                const primaryDocId = safeDocId(typeStr, id)
                const fallbackDocId = legacySafeDocId(typeStr, id)
                try {
                  let snap = await colRef.doc(primaryDocId).get()
                  if ((!snap.exists || !snap.data()?.json) && fallbackDocId !== primaryDocId) {
                    snap = await colRef.doc(fallbackDocId).get()
                  }
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
          let batch = db.batch()
          let ops = 0

          const flushBatch = async () => {
            if (ops === 0) return
            try {
              await batch.commit()
            } catch (err) {
              console.warn('[Baileys FirestoreAuth] Error guardando keys batch:', err)
            }
            batch = db.batch()
            ops = 0
          }

          for (const category in data) {
            const catData = data[category]
            if (!catData) continue
            for (const id in catData) {
              const value = catData[id]
              const cacheKey = `${category}:${id}`
              const primaryDocId = safeDocId(category, id)
              const fallbackDocId = legacySafeDocId(category, id)
              const docRef = colRef.doc(primaryDocId)
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
                if (fallbackDocId !== primaryDocId) {
                  batch.delete(colRef.doc(fallbackDocId))
                  ops++
                }
              }
              if (ops >= 400) {
                await flushBatch()
              }
            }
          }

          await flushBatch()
        },
      },
    },
  }
}

const MANAGER_VERSION = 34

// Neutralizar timers huérfanos de instancias anteriores (v1..v6) tras Hot Reload en Next.js dev
const globalForTimerPatch = globalThis as unknown as {
  __fuddiOrigSetTimeout?: typeof globalThis.setTimeout
}
if (!globalForTimerPatch.__fuddiOrigSetTimeout) {
  globalForTimerPatch.__fuddiOrigSetTimeout = globalThis.setTimeout.bind(globalThis)
  globalThis.setTimeout = ((fn: any, delay?: number, ...args: any[]) => {
    if (
      delay === 2500 &&
      typeof fn === 'function' &&
      String(fn).includes('connect(businessId')
    ) {
      return globalForTimerPatch.__fuddiOrigSetTimeout!(() => {}, 0)
    }
    return globalForTimerPatch.__fuddiOrigSetTimeout!(fn, delay, ...args)
  }) as typeof globalThis.setTimeout
}

class WhatsAppBaileysManager {
  public readonly version = MANAGER_VERSION
  private sessions = new Map<string, ManagedSession>()
  private lidToPhoneCache = new Map<string, string>()
  private phoneToLidCache = new Map<string, string>()
  private logger = pino({ level: 'silent' })

  public shutdownForUpgrade() {
    for (const s of this.sessions.values()) {
      s.manualDisconnect = true
      try {
        if (s.reconnectTimer) clearTimeout(s.reconnectTimer)
      } catch {}
      try {
        s.firestoreUnsub?.()
      } catch {}
      try {
        s.excludedUnsub?.()
      } catch {}
      try {
        s.socket?.ev?.removeAllListeners?.('connection.update')
        s.socket?.ev?.removeAllListeners?.('messages.upsert')
        s.socket?.ev?.removeAllListeners?.('creds.update')
      } catch {}
      try {
        s.socket?.end?.(undefined)
      } catch {}
    }
    this.sessions.clear()
  }

  private async resolvePhoneFromLid(businessId: string, rawLidOrJid: string): Promise<string | null> {
    const lidDigits = String(rawLidOrJid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
    if (!lidDigits || !isWhatsAppLidDigits(lidDigits)) return null
    const cacheKey = `${businessId}:${lidDigits}`
    if (this.lidToPhoneCache.has(cacheKey)) {
      return this.lidToPhoneCache.get(cacheKey) || null
    }
    const db = ensureAdminDb()
    if (!db) return null
    try {
      const snap = await db
        .collection('businesses')
        .doc(businessId)
        .collection('whatsappAuth')
        .doc(`key_lid-mapping_${lidDigits}_reverse`)
        .get()
      if (snap.exists && snap.data()?.json) {
        const parsed = String(JSON.parse(String(snap.data()!.json)) || '').replace(/\D/g, '')
        const norm = normalizeEcuadorPhone(parsed)
        if (norm.length >= 9 && !isWhatsAppLidDigits(norm)) {
          this.lidToPhoneCache.set(cacheKey, norm)
          this.phoneToLidCache.set(`${businessId}:${norm}`, `${lidDigits}@lid`)
          return norm
        }
      }
    } catch {
      // Ignorar
    }
    return null
  }

  private async resolveLidFromPhone(businessId: string, normPhone: string): Promise<string | null> {
    const clean = normalizeEcuadorPhone(normPhone)
    if (!clean || isWhatsAppLidDigits(clean)) return null
    const cacheKey = `${businessId}:${clean}`
    if (this.phoneToLidCache.has(cacheKey)) {
      return this.phoneToLidCache.get(cacheKey) || null
    }
    const intl = ecuadorPhoneToIntlDigits(clean)
    const db = ensureAdminDb()
    if (!db || !intl) return null
    try {
      const snap = await db
        .collection('businesses')
        .doc(businessId)
        .collection('whatsappAuth')
        .doc(`key_lid-mapping_${intl}`)
        .get()
      if (snap.exists && snap.data()?.json) {
        const lidDigits = String(JSON.parse(String(snap.data()!.json)) || '').replace(/\D/g, '')
        if (lidDigits) {
          const lidJid = `${lidDigits}@lid`
          this.phoneToLidCache.set(cacheKey, lidJid)
          this.lidToPhoneCache.set(`${businessId}:${lidDigits}`, clean)
          return lidJid
        }
      }
    } catch {
      // Ignorar
    }
    return null
  }

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
        baileysHistoryByDoc: new Map(),
        repairingDocIds: new Set(),
        reconnectTimer: null,
        reconnectAttempts: 0,
        outgoingSendTimestamps: [],
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

    // Si en memoria está desconectado (y no fue por ceder la conexión ante otra instancia activa), revisar si hay credenciales en Firestore
    if (
      session.state.status === 'disconnected' &&
      !session.isConnecting &&
      !session.manualDisconnect &&
      session.state.lastError !== 'Conflict (440)'
    ) {
      try {
        const { hasExistingCreds } = await useFirestoreAuthState(businessId)
        if (hasExistingCreds) {
          await this.connect(businessId, { waitMs: Math.max(holdMs, 8000) })
          return session.state
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

              // 1. Si Android sobrescribió chatHistory borrando mensajes enriquecidos de Baileys o agregando ecos genéricos ("🛒 Recibiste una solicitud de pedido."), restaurarlos
              if (
                session.baileysHistoryByDoc.has(docSnap.id) &&
                !session.repairingDocIds.has(docSnap.id)
              ) {
                const currentHistory: any[] = Array.isArray(data.chatHistory) ? data.chatHistory : []
                const repairedHistory = mergeWithBaileysRichHistory(
                  session,
                  docSnap.id,
                  currentHistory
                )
                const currentJson = JSON.stringify(
                  currentHistory.map((x) => ({
                    id: x?.id,
                    text: x?.text,
                    mediaUrl: x?.mediaUrl || null,
                    mediaType: x?.mediaType || null,
                  }))
                )
                const repairedJson = JSON.stringify(
                  repairedHistory.map((x) => ({
                    id: x?.id,
                    text: x?.text,
                    mediaUrl: x?.mediaUrl || null,
                    mediaType: x?.mediaType || null,
                  }))
                )
                if (currentJson !== repairedJson) {
                  session.repairingDocIds.add(docSnap.id)
                  const lastIncoming = [...repairedHistory]
                    .reverse()
                    .find((x) => !x?.fromMe && x?.text)
                  const updatePayload: Record<string, any> = {
                    chatHistory: repairedHistory,
                  }
                  if (lastIncoming?.text) {
                    updatePayload.lastMessage = lastIncoming.text
                  }
                  void docSnap.ref
                    .set(updatePayload, { merge: true })
                    .catch(() => {})
                    .finally(() => {
                      session.repairingDocIds.delete(docSnap.id)
                    })
                }
              }

              // Seguridad: el envío de mensajes ya no se dispara automáticamente por escritura en Firestore (pendingReply),
              // sino exclusivamente mediante la API autenticada (/api/whatsapp/bridge con Firebase ID Token + x-worker-secret).
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
        const deadline = Date.now() + waitMs
        while (session.isConnecting && session.state.status === 'connecting' && Date.now() < deadline) {
          const remaining = deadline - Date.now()
          if (remaining <= 0) break
          await this.waitForStateChange(session, remaining)
        }
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

      try {
        if (session.socket) {
          session.socket.ev?.removeAllListeners?.('connection.update')
          session.socket.ev?.removeAllListeners?.('messages.upsert')
          session.socket.ev?.removeAllListeners?.('creds.update')
          session.socket.end?.(undefined)
          session.socket = null
        }
      } catch {
        // Ignorar
      }

      const sock = makeWASocket({
        version,
        auth: state,
        logger: this.logger as any,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        fireInitQueries: false,
        markOnlineOnConnect: false,
      })

      session.socket = sock
      this.setupFirestoreListeners(session)

      sock.ev.on('creds.update', saveCreds)

      let pairingRequestedForSocket = false

      sock.ev.on('connection.update', async (update) => {
        if (session.socket !== sock) return
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
          session.reconnectAttempts = 0
          const meJid = sock.user?.id || ''
          const rawMePhone = meJid.split(':')[0]?.split('@')[0] || ''
          session.state.status = 'connected'
          session.state.qrDataUrl = null
          session.state.pairingCode = null
          session.state.connectedPhone = normalizeEcuadorPhone(rawMePhone) || rawMePhone || null
          session.state.connectedName = sock.user?.name || null
          session.state.lastError = null
          console.log(
            `[Baileys] Conectado business=${businessId} phone=${session.state.connectedPhone} name=${session.state.connectedName || '-'}`
          )
          await this.persistConnectionState(session)
          await this.markAllConversationsDirectReplyReady(businessId, true)
        }

        if (connection === 'close') {
          session.isConnecting = false
          session.socket = null
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
          const disconnectMsg = (lastDisconnect?.error as any)?.message || String(statusCode || '')
          const loggedOut = statusCode === DisconnectReason.loggedOut
          const isAuthForbidden = statusCode === 401 || statusCode === 403 || statusCode === 405
          const isConflict =
            statusCode === 440 ||
            statusCode === DisconnectReason.connectionReplaced ||
            String(disconnectMsg).toLowerCase().includes('conflict')
          console.warn(
            `[Baileys] Conexión cerrada business=${businessId} code=${statusCode} msg=${disconnectMsg} loggedOut=${loggedOut} conflict=${isConflict}`
          )

          if (loggedOut) {
            await clearState()
            session.state.status = 'disconnected'
            session.state.qrDataUrl = null
            session.state.pairingCode = null
            session.state.connectedPhone = null
            session.state.connectedName = null
            session.state.lastError = 'Sesión cerrada desde el teléfono'
            await this.persistConnectionState(session)
          } else if (isAuthForbidden) {
            session.state.status = 'disconnected'
            session.state.qrDataUrl = null
            session.state.pairingCode = null
            session.state.lastError = `Sesión rechazada por WhatsApp (${statusCode})`
            await this.persistConnectionState(session)
          } else if (isConflict) {
            // Otra instancia tomó la conexión activa; no reconectar en bucle
            session.state.status = 'disconnected'
            session.state.qrDataUrl = null
            session.state.pairingCode = null
            session.state.lastError = 'Conflict (440)'
            this.notifyStateWaiters(session)
          } else if (!session.manualDisconnect && this.version === MANAGER_VERSION) {
            // Backoff exponencial (3s -> 6s -> 12s -> 24s -> 60s máx) con jitter para proteger la cuenta ante WhatsApp
            const attempt = session.reconnectAttempts
            session.reconnectAttempts = Math.min(attempt + 1, 6)
            const baseDelay = Math.min(60_000, 3_000 * Math.pow(2, attempt))
            const jitter = Math.floor(Math.random() * 1000)
            const delayMs = baseDelay + jitter
            session.state.status = 'connecting'
            session.state.lastError = `Reconectando en ${Math.round(delayMs / 1000)}s (${disconnectMsg})`
            await this.persistConnectionState(session)
            session.reconnectTimer = setTimeout(() => {
              if (this.version !== MANAGER_VERSION || session.manualDisconnect) return
              void this.connect(businessId, { waitMs: 0 })
            }, delayMs)
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
            await this.handleUpsertedMessage(session, msg, type)
          } catch (err) {
            console.warn('[Baileys] Error procesando mensaje:', err)
          }
        }
      })

      sock.ev.on('messages.reaction', async (reactions) => {
        for (const item of reactions) {
          try {
            const targetKey = item?.key
            const reaction = item?.reaction
            const remoteJid = String(targetKey?.remoteJid || reaction?.key?.remoteJid || '').trim()
            const targetWaId = String(targetKey?.id || '').trim()
            const emoji = String(reaction?.text || '').trim()
            const reactorIsMe = Boolean(reaction?.key?.fromMe)
            if (remoteJid && targetWaId) {
              await this.handleIncomingReaction(session, remoteJid, targetWaId, emoji, reactorIsMe)
            }
          } catch (err) {
            console.warn('[Baileys] Error procesando reacción entrante:', err)
          }
        }
      })

      // Sincronizar lectura desde WhatsApp → Firestore (si el usuario lee el chat en WhatsApp, poner unreadCount = 0)
      sock.ev.on('chats.update', async (updates) => {
        for (const chat of updates) {
          try {
            if (chat?.unreadCount !== 0) continue
            const remoteJid = String(chat?.id || '').trim()
            if (
              !remoteJid ||
              remoteJid === 'status@broadcast' ||
              remoteJid.endsWith('@g.us') ||
              remoteJid.endsWith('@newsletter')
            ) {
              continue
            }
            const db = ensureAdminDb()
            if (!db) continue
            const colRef = db
              .collection('businesses')
              .doc(session.businessId)
              .collection('whatsappPending')
            const snap = await colRef.where('whatsappJid', '==', remoteJid).limit(3).get()
            for (const docSnap of snap.docs) {
              const data = docSnap.data() || {}
              if (typeof data.unreadCount === 'number' && data.unreadCount > 0) {
                await docSnap.ref.set({ unreadCount: 0 }, { merge: true })
              }
            }
          } catch {
            // Ignorar errores transitorios de sincronización de lectura
          }
        }
      })

      // Esperar hasta que Baileys emita el primer QR, el pairingCode o abra la conexión
      if (waitMs > 0) {
        const deadline = Date.now() + waitMs
        while (session.state.status === 'connecting' && Date.now() < deadline) {
          const remaining = deadline - Date.now()
          if (remaining <= 0) break
          await this.waitForStateChange(session, remaining)
        }
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

  private async handleIncomingReaction(
    session: ManagedSession,
    remoteJid: string,
    targetWaId: string,
    emoji: string,
    reactorIsMe: boolean
  ) {
    if (
      !remoteJid ||
      !targetWaId ||
      remoteJid === 'status@broadcast' ||
      remoteJid.endsWith('@g.us') ||
      remoteJid.endsWith('@newsletter')
    ) {
      return
    }

    const isLid = remoteJid.endsWith('@lid')
    let phoneSource = remoteJid.split('@')[0]
    if (isLid) {
      const mappedPhone = await this.resolvePhoneFromLid(session.businessId, remoteJid)
      if (mappedPhone) phoneSource = mappedPhone
    }
    const normPhone = normalizeEcuadorPhone(phoneSource)

    const db = ensureAdminDb()
    if (!db) return
    const colRef = db
      .collection('businesses')
      .doc(session.businessId)
      .collection('whatsappPending')

    let targetDocRef: FirebaseFirestore.DocumentReference | null = null
    let targetDocData: Record<string, any> | null = null

    if (normPhone.length >= 9) {
      const colonSnap = await colRef.doc(`phone:${normPhone}`).get()
      if (colonSnap.exists) {
        targetDocRef = colonSnap.ref
        targetDocData = colonSnap.data() || {}
      } else {
        const underscoreSnap = await colRef.doc(`phone_${normPhone}`).get()
        if (underscoreSnap.exists) {
          targetDocRef = underscoreSnap.ref
          targetDocData = underscoreSnap.data() || {}
        }
      }
    }

    if (!targetDocRef) {
      const recentSnap = await colRef.orderBy('timestampMillis', 'desc').limit(30).get()
      const matched = recentSnap.docs.find((d) => {
        const data = d.data() || {}
        if (data.whatsappJid === remoteJid) return true
        const hist: any[] = Array.isArray(data.chatHistory) ? data.chatHistory : []
        return hist.some((h) => h?.id === targetWaId || h?.waMsgId === targetWaId)
      })
      if (matched) {
        targetDocRef = matched.ref
        targetDocData = matched.data() || {}
      }
    }

    if (!targetDocRef || !targetDocData || !Array.isArray(targetDocData.chatHistory)) return

    let updated = false
    const nextHistory = targetDocData.chatHistory.map((h: any) => {
      if (h?.id !== targetWaId && h?.waMsgId !== targetWaId) return h
      updated = true
      const prevReactions: Array<{ emoji: string; fromMe: boolean }> = Array.isArray(h.reactions)
        ? h.reactions
        : []
      const filtered = prevReactions.filter((r) => Boolean(r?.fromMe) !== reactorIsMe)
      const nextReactions = emoji ? [...filtered, { emoji, fromMe: reactorIsMe }] : filtered
      const updatedEntry = { ...h, reactions: nextReactions }
      recordBaileysHistoryEntry(session, targetDocRef!.id, updatedEntry)
      return updatedEntry
    })

    if (updated) {
      await targetDocRef.set({ chatHistory: nextHistory }, { merge: true })
    }
  }

  private async handleUpsertedMessage(
    session: ManagedSession,
    msg: proto.IWebMessageInfo,
    upsertType: 'notify' | 'append' = 'notify'
  ) {
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

    const rawTsEarly = Number(msg.messageTimestamp || 0)
    const msgMillisEarly =
      rawTsEarly > 0 ? (rawTsEarly < 10_000_000_000 ? rawTsEarly * 1000 : rawTsEarly) : Date.now()
    // Evitar reabrir chats viejos si WhatsApp sincroniza mensajes históricos en modo 'append'
    if (upsertType === 'append' && Date.now() - msgMillisEarly > 15 * 60 * 1000) {
      return
    }

    const isLid = remoteJid.endsWith('@lid')
    const altParticipant =
      (msg.key as any)?.remoteJidAlt ||
      (msg.key as any)?.senderPn ||
      (msg as any)?.senderPn ||
      msg.participant ||
      ''
    let phoneSource = remoteJid.endsWith('@s.whatsapp.net')
      ? remoteJid.split('@')[0]
      : altParticipant.includes('@s.whatsapp.net')
        ? altParticipant.split('@')[0]
        : remoteJid.split('@')[0]

    if (isLid && !altParticipant.includes('@s.whatsapp.net')) {
      const mappedPhone = await this.resolvePhoneFromLid(session.businessId, remoteJid)
      if (mappedPhone) {
        phoneSource = mappedPhone
      }
    }

    let normPhone = normalizeEcuadorPhone(phoneSource)
    if (normPhone.length < 9) return
    if (session.excludedPhones.has(normPhone)) return

    // 0. Manejar reacciones entrantes/salientes si llegaran por messages.upsert
    const reactionMsg = msg.message?.reactionMessage
    if (reactionMsg?.key?.id) {
      await this.handleIncomingReaction(
        session,
        remoteJid,
        String(reactionMsg.key.id).trim(),
        String(reactionMsg.text || '').trim(),
        Boolean(msg.key?.fromMe)
      )
      return
    }

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

    // Si se resolvió un @lid a su número real (09...) y quedó un documento huérfano phone_{lid}, unificar y borrar el duplicado
    if (isLid && !isWhatsAppLidDigits(normPhone)) {
      const lidDigits = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '')
      const orphanIds = [`phone_${lidDigits}`, `phone:${lidDigits}`].filter((id) => id !== docId)
      for (const orphanId of orphanIds) {
        try {
          const orphanRef = colRef.doc(orphanId)
          const orphanSnap = await orphanRef.get()
          if (orphanSnap.exists) {
            const orphanData = orphanSnap.data() || {}
            if (existing) {
              const mergedHistory = [
                ...(Array.isArray(existing.chatHistory) ? existing.chatHistory : []),
                ...(Array.isArray(orphanData.chatHistory) ? orphanData.chatHistory : []),
              ]
                .filter((item, idx, arr) => item?.id ? arr.findIndex((x) => x?.id === item.id) === idx : true)
                .sort((a, b) => Number(a?.timestampMillis || 0) - Number(b?.timestampMillis || 0))
                .slice(-MAX_CHAT_HISTORY)
              existing.chatHistory = mergedHistory
              if (!existing.detectedLocationLink && orphanData.detectedLocationLink) {
                existing.detectedLocationLink = orphanData.detectedLocationLink
              }
            } else {
              existing = orphanData
            }
            await orphanRef.delete()
          }
        } catch {
          // Ignorar error limpiando duplicado
        }
      }
    }

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
    const newBaileysEntry = {
      id: msgId,
      text,
      timestampMillis: Math.max(nowMillis, msgMillis),
      fromMe: false,
      source: 'baileys',
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(mediaType ? { mediaType } : {}),
      ...(fileName ? { fileName } : {}),
    }
    recordBaileysHistoryEntry(session, docId, newBaileysEntry)
    const nextHistory = mergeWithBaileysRichHistory(session, docId, [
      ...prevHistory.filter((h) => h?.id !== msgId),
      newBaileysEntry,
    ])

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
    console.log(
      `[Baileys] Mensaje entrante guardado business=${session.businessId} doc=${docId} phone=${normPhone} media=${mediaType || 'text'}`
    )
  }

  public async sendOutgoingMessage(
    businessId: string,
    docId: string,
    phone: string,
    text: string,
    replyId = `baileys_${Date.now()}`,
    linkPreview?: LinkPreviewData | null
  ): Promise<{ ok: boolean; error?: string }> {
    const cleanText = text.trim()
    if (!cleanText) return { ok: false, error: 'Mensaje vacío' }
    if (cleanText.length > MAX_OUTGOING_TEXT_LENGTH) {
      return { ok: false, error: `El mensaje excede el límite de ${MAX_OUTGOING_TEXT_LENGTH} caracteres` }
    }

    const session = this.getOrCreateSession(businessId)

    // Rate limit anti-ban: máximo 25 mensajes salientes por minuto por negocio
    const nowRate = Date.now()
    session.outgoingSendTimestamps = session.outgoingSendTimestamps.filter(
      (ts) => nowRate - ts < 60_000
    )
    if (session.outgoingSendTimestamps.length >= MAX_OUTGOING_PER_MINUTE) {
      return {
        ok: false,
        error: 'Límite de envío alcanzado por seguridad (máx. 25 mensajes/minuto). Intenta en unos segundos.',
      }
    }
    session.outgoingSendTimestamps.push(nowRate)

    // Si la instancia Serverless de Vercel estaba fría (o cedió el socket ante otra instancia) pero hay credenciales guardadas en Firestore, reconectar al vuelo al momento de enviar
    for (let attempt = 0; attempt < 2; attempt++) {
      if (session.state.status === 'connected' && session.socket) break
      try {
        const { hasExistingCreds } = await useFirestoreAuthState(businessId)
        if (hasExistingCreds) {
          await this.connect(businessId, { waitMs: 12000 })
        }
      } catch {
        // Ignorar
      }
      if (session.state.status !== 'connected' || !session.socket) {
        await new Promise((r) => setTimeout(r, 800))
      }
    }

    if (session.state.status !== 'connected' || !session.socket) {
      return {
        ok: false,
        error: `WhatsApp no está conectado como dispositivo vinculado (${session.state.status}: ${session.state.lastError || 'sin socket'})`,
      }
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

    const rawCandidatePhone = phone || existingDocData.phone || existingDocData.rawPhone || ''
    let explicitJid = String(existingDocData.whatsappJid || '').trim()

    // Si en WhatsApp Auth existe un LID mapeado para este teléfono (o viceversa), preferir el JID con sesión activa en Baileys
    if (!explicitJid) {
      if (isWhatsAppLidDigits(rawCandidatePhone)) {
        explicitJid = `${rawCandidatePhone.replace(/\D/g, '')}@lid`
      } else {
        const lidForPhone = await this.resolveLidFromPhone(businessId, rawCandidatePhone)
        if (lidForPhone) {
          explicitJid = lidForPhone
        }
      }
    }

    const jid = ecuadorPhoneToJid(rawCandidatePhone, explicitJid)
    if (!jid) return { ok: false, error: 'Número o JID de WhatsApp inválido' }

    try {
      session.processedReplyIds.add(replyId)

      // Preparar vista previa rica de enlace (OpenGraph + miniatura JPEG) si el mensaje incluye URL
      let resolvedPreview: LinkPreviewData | null = null
      if (linkPreview !== null) {
        if (linkPreview && linkPreview.url) {
          resolvedPreview = linkPreview
        } else {
          const detectedUrl = extractFirstUrlFromText(cleanText)
          if (detectedUrl) {
            resolvedPreview = await fetchLinkPreviewMetadata(detectedUrl)
          }
        }
      }

      const jpegThumbnail = resolvedPreview?.image
        ? await fetchLinkPreviewJpegThumbnail(resolvedPreview.image)
        : undefined

      const baileysMessagePayload: any = {
        text: cleanText,
        ...(resolvedPreview
          ? {
              linkPreview: {
                'canonical-url': resolvedPreview.url,
                'matched-text':
                  resolvedPreview.matchedText ||
                  extractFirstUrlFromText(cleanText) ||
                  resolvedPreview.url,
                title: resolvedPreview.title || resolvedPreview.siteName,
                description: resolvedPreview.description || '',
                ...(jpegThumbnail ? { jpegThumbnail } : {}),
              },
            }
          : {}),
      }

      let sentMsg: any
      let lastSendErr: any = null

      for (let sendAttempt = 0; sendAttempt < 2; sendAttempt++) {
        let activeSocket = session.socket
        if (!activeSocket || session.state.status !== 'connected') {
          await this.connect(businessId, { waitMs: 12000 })
          activeSocket = session.socket
        }
        if (!activeSocket) {
          lastSendErr = new Error('Socket de WhatsApp no disponible')
          continue
        }
        try {
          sentMsg = await activeSocket.sendMessage(jid, baileysMessagePayload)
          lastSendErr = null
          break
        } catch (err: any) {
          lastSendErr = err
          const msg = String(err?.message || '').toLowerCase()
          if (
            sendAttempt === 0 &&
            (msg.includes('closed') || msg.includes('connection') || msg.includes('null'))
          ) {
            await this.connect(businessId, { waitMs: 12000 })
            continue
          }
          throw err
        }
      }

      if (lastSendErr) {
        throw lastSendErr
      }

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
        const outgoingEntry: Record<string, any> = {
          id: replyId,
          ...(sentMsg?.key?.id ? { waMsgId: sentMsg.key.id } : {}),
          text: cleanText,
          timestampMillis: nowOut,
          fromMe: true,
          source: 'baileys',
        }
        if (resolvedPreview) {
          outgoingEntry.linkPreview = {
            url: resolvedPreview.url,
            matchedText: resolvedPreview.matchedText,
            title: resolvedPreview.title,
            description: resolvedPreview.description,
            image: resolvedPreview.image || null,
            siteName: resolvedPreview.siteName,
          }
        }
        recordBaileysHistoryEntry(session, docId, outgoingEntry)
        const nextHistory = [
          ...currentHistory.filter((h) => h?.id !== replyId),
          outgoingEntry,
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

  public async sendReaction(
    businessId: string,
    docId: string,
    phone: string,
    messageId: string,
    targetFromMe: boolean,
    emoji: string
  ): Promise<{ ok: boolean; error?: string }> {
    const cleanMsgId = String(messageId || '').trim()
    if (!cleanMsgId) return { ok: false, error: 'messageId requerido' }

    const session = this.getOrCreateSession(businessId)

    for (let attempt = 0; attempt < 2; attempt++) {
      if (session.state.status === 'connected' && session.socket) break
      try {
        const { hasExistingCreds } = await useFirestoreAuthState(businessId)
        if (hasExistingCreds) {
          await this.connect(businessId, { waitMs: 12000 })
        }
      } catch {
        // Ignorar
      }
      if (session.state.status !== 'connected' || !session.socket) {
        await new Promise((r) => setTimeout(r, 800))
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

    const rawCandidatePhone = phone || existingDocData.phone || existingDocData.rawPhone || ''
    let explicitJid = String(existingDocData.whatsappJid || '').trim()
    if (!explicitJid) {
      if (isWhatsAppLidDigits(rawCandidatePhone)) {
        explicitJid = `${rawCandidatePhone.replace(/\D/g, '')}@lid`
      } else {
        const lidForPhone = await this.resolveLidFromPhone(businessId, rawCandidatePhone)
        if (lidForPhone) {
          explicitJid = lidForPhone
        }
      }
    }

    const jid = ecuadorPhoneToJid(rawCandidatePhone, explicitJid)
    if (!jid) return { ok: false, error: 'Número o JID de WhatsApp inválido' }

    const currentHistory: any[] = Array.isArray(existingDocData.chatHistory)
      ? existingDocData.chatHistory
      : []
    const matchedEntry = currentHistory.find(
      (h) => h?.id === cleanMsgId || h?.waMsgId === cleanMsgId
    )
    const waTargetId = String(matchedEntry?.waMsgId || cleanMsgId).trim()
    const cleanEmoji = String(emoji || '').trim()

    try {
      const activeSocket = session.socket
      if (!activeSocket) return { ok: false, error: 'Socket de WhatsApp no disponible' }

      const sentReact = await activeSocket.sendMessage(jid, {
        react: {
          text: cleanEmoji,
          key: {
            remoteJid: jid,
            fromMe: Boolean(targetFromMe),
            id: waTargetId,
          },
        },
      })
      if (sentReact?.key?.id) {
        session.sentByBridgeMsgIds.add(sentReact.key.id)
      }

      if (docRef && currentHistory.length > 0) {
        const nextHistory = currentHistory.map((h) => {
          if (h?.id !== cleanMsgId && h?.waMsgId !== cleanMsgId) return h
          const prevReactions: Array<{ emoji: string; fromMe: boolean }> = Array.isArray(h.reactions)
            ? h.reactions
            : []
          const filtered = prevReactions.filter((r) => !r?.fromMe)
          const nextReactions = cleanEmoji
            ? [...filtered, { emoji: cleanEmoji, fromMe: true }]
            : filtered
          const updatedEntry = { ...h, reactions: nextReactions }
          recordBaileysHistoryEntry(session, docId, updatedEntry)
          return updatedEntry
        })
        await docRef.set({ chatHistory: nextHistory }, { merge: true })
      }

      return { ok: true }
    } catch (err: any) {
      console.error('[Baileys] Error enviando reacción:', err)
      return { ok: false, error: err?.message || 'Error al enviar reacción' }
    }
  }

  public async markConversationAsRead(
    businessId: string,
    docId: string,
    phone: string,
    messageIds?: string[]
  ): Promise<{ ok: boolean; markedCount?: number; error?: string }> {
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
        await docRef.set({ unreadCount: 0 }, { merge: true })
      } catch {
        // Ignorar error de lectura/escritura parcial
      }
    }

    const session = this.getOrCreateSession(businessId)
    if (session.state.status !== 'connected' || !session.socket) {
      return { ok: true, markedCount: 0 }
    }

    const rawCandidatePhone = phone || existingDocData.phone || existingDocData.rawPhone || ''
    let explicitJid = String(existingDocData.whatsappJid || '').trim()
    if (!explicitJid) {
      if (isWhatsAppLidDigits(rawCandidatePhone)) {
        explicitJid = `${rawCandidatePhone.replace(/\D/g, '')}@lid`
      } else {
        const lidForPhone = await this.resolveLidFromPhone(businessId, rawCandidatePhone)
        if (lidForPhone) {
          explicitJid = lidForPhone
        }
      }
    }

    const jid = ecuadorPhoneToJid(rawCandidatePhone, explicitJid)
    if (!jid) return { ok: true, markedCount: 0 }

    const idSet = new Set<string>()
    const isSyntheticId = (id: string) =>
      !id ||
      id.startsWith('in_') ||
      id.startsWith('msg_') ||
      id.startsWith('web_') ||
      id.startsWith('android_') ||
      id.startsWith('reply_')

    if (Array.isArray(messageIds)) {
      for (const rawId of messageIds) {
        const clean = String(rawId || '').trim()
        if (clean && !isSyntheticId(clean)) {
          idSet.add(clean)
        }
      }
    }

    const currentHistory: any[] = Array.isArray(existingDocData.chatHistory)
      ? existingDocData.chatHistory
      : []
    for (let i = currentHistory.length - 1; i >= 0 && idSet.size < 20; i--) {
      const h = currentHistory[i]
      if (!h || h.fromMe) continue
      const candidate = String(h.waMsgId || h.id || '').trim()
      if (candidate && !isSyntheticId(candidate)) {
        idSet.add(candidate)
      }
    }

    const keys = Array.from(idSet).map((id) => ({
      remoteJid: jid,
      id,
      fromMe: false,
    }))

    if (keys.length === 0) {
      return { ok: true, markedCount: 0 }
    }

    try {
      const activeSocket = session.socket
      if (!activeSocket) return { ok: true, markedCount: 0 }

      // Enviar únicamente confirmación de lectura (recibo estándar de mensajería) a WhatsApp.
      // IMPORTANTE: No usar activeSocket.chatModify({ markRead: true }) porque escribe parches en
      // w:sync:app:state (LTHash) que, con syncFullHistory: false, provocan SyncdFatalError y cierran
      // la sesión de los teléfonos compañeros vinculados (iOS/Android Companion Mode).
      await activeSocket.readMessages(keys)

      return { ok: true, markedCount: keys.length }
    } catch (err: any) {
      console.warn('[Baileys] Error marcando mensajes como leídos:', err?.message || err)
      return { ok: false, error: err?.message || 'Error al marcar como leído' }
    }
  }

  public getActiveSessionsSummary(): Array<{
    businessId: string
    status: BaileysConnectionStatus
    connectedPhone: string | null
    connectedName: string | null
    lastError: string | null
    updatedAtMillis: number
  }> {
    return Array.from(this.sessions.values()).map((s) => ({
      businessId: s.businessId,
      status: s.state.status,
      connectedPhone: s.state.connectedPhone,
      connectedName: s.state.connectedName,
      lastError: s.state.lastError,
      updatedAtMillis: s.state.updatedAtMillis,
    }))
  }

  public async autoConnectRegisteredBusinesses(): Promise<string[]> {
    const db = ensureAdminDb()
    if (!db) {
      console.warn('[Baileys Worker] Firebase Admin no disponible para auto-conexión')
      return []
    }
    const connectedIds: string[] = []
    try {
      const businessesSnap = await db.collection('businesses').select().get()
      for (const bizDoc of businessesSnap.docs) {
        const businessId = bizDoc.id
        try {
          const { hasExistingCreds } = await useFirestoreAuthState(businessId)
          if (hasExistingCreds) {
            console.log(`[Baileys Worker] Auto-conectando business=${businessId}...`)
            connectedIds.push(businessId)
            void this.connect(businessId, { waitMs: 0 })
          }
        } catch (err) {
          console.warn(`[Baileys Worker] Error verificando creds de ${businessId}:`, err)
        }
      }
    } catch (err) {
      console.error('[Baileys Worker] Error listando businesses para auto-conexión:', err)
    }
    return connectedIds
  }

  public async reconnectIdleSessions(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (
        session.state.status === 'disconnected' &&
        !session.isConnecting &&
        !session.manualDisconnect &&
        session.state.lastError !== 'Sesión cerrada desde el teléfono' &&
        session.state.lastError !== 'Conflict (440)' &&
        !(session.state.lastError || '').startsWith('Sesión rechazada')
      ) {
        try {
          const { hasExistingCreds } = await useFirestoreAuthState(session.businessId)
          if (hasExistingCreds) {
            console.log(
              `[Baileys Worker] Watchdog reconectando business=${session.businessId} (lastError=${session.state.lastError || 'none'})`
            )
            void this.connect(session.businessId, { waitMs: 0 })
          }
        } catch {
          // Ignorar error transitorio
        }
      }
    }
  }
}

const globalForBaileys = globalThis as unknown as {
  __fuddiBaileysManager?: WhatsAppBaileysManager
}

export function getWhatsAppBaileysManager(): WhatsAppBaileysManager {
  const existing = globalForBaileys.__fuddiBaileysManager
  if (!existing || existing.version !== MANAGER_VERSION) {
    if (existing) {
      try {
        if ((existing as any).sessions) {
          for (const s of (existing as any).sessions.values()) {
            s.manualDisconnect = true
            try {
              if (s.reconnectTimer) clearTimeout(s.reconnectTimer)
            } catch {}
            try {
              s.firestoreUnsub?.()
            } catch {}
            try {
              s.excludedUnsub?.()
            } catch {}
            try {
              s.socket?.ev?.removeAllListeners?.('connection.update')
              s.socket?.ev?.removeAllListeners?.('messages.upsert')
              s.socket?.ev?.removeAllListeners?.('creds.update')
            } catch {}
            try {
              s.socket?.end?.(undefined)
            } catch {}
          }
        }
        if (typeof existing.shutdownForUpgrade === 'function') {
          existing.shutdownForUpgrade()
        }
      } catch {
        // Ignorar errores al limpiar instancia previa
      }
    }
    globalForBaileys.__fuddiBaileysManager = new WhatsAppBaileysManager()
  }
  return globalForBaileys.__fuddiBaileysManager!
}
