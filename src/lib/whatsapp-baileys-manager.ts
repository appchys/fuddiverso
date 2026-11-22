import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  WASocket,
  proto,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import QRCode from 'qrcode'
import * as fs from 'fs'
import * as path from 'path'
import { ensureAdminDb } from '@/lib/firebase-admin'

export type BaileysConnectionStatus = 'disconnected' | 'connecting' | 'qr' | 'connected'

export interface BaileysBusinessState {
  businessId: string
  status: BaileysConnectionStatus
  qrDataUrl: string | null
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
}

const SESSIONS_ROOT = path.join(process.cwd(), '.whatsapp-sessions')
const MAX_RECENT_MESSAGES = 8

export function normalizeEcuadorPhone(raw?: string | null): string {
  if (!raw) return ''
  let digits = String(raw).replace(/\D/g, '')
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

export function ecuadorPhoneToJid(rawPhone: string): string | null {
  const digits = String(rawPhone || '').replace(/\D/g, '')
  if (digits.length < 9) return null
  if (digits.length === 10 && digits.startsWith('09')) {
    return `593${digits.slice(1)}@s.whatsapp.net`
  }
  if (digits.length === 9 && digits.startsWith('9')) {
    return `593${digits}@s.whatsapp.net`
  }
  return `${digits}@s.whatsapp.net`
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

function extractMessageContent(msg: proto.IWebMessageInfo): {
  text: string
  locationLink: string | null
} {
  const m = msg.message
  if (!m) return { text: '', locationLink: null }

  // Desempaquetar contenedores efímeros o viewOnce
  const inner =
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.documentWithCaptionMessage?.message ||
    m

  if (inner.locationMessage) {
    const lat = inner.locationMessage.degreesLatitude
    const lng = inner.locationMessage.degreesLongitude
    if (typeof lat === 'number' && typeof lng === 'number') {
      const link = `https://www.google.com/maps?q=${lat},${lng}`
      const label = inner.locationMessage.name || inner.locationMessage.address || 'Ubicación enviada'
      return { text: `📍 ${label}: ${link}`, locationLink: link }
    }
  }

  if (inner.liveLocationMessage) {
    const lat = inner.liveLocationMessage.degreesLatitude
    const lng = inner.liveLocationMessage.degreesLongitude
    if (typeof lat === 'number' && typeof lng === 'number') {
      const link = `https://www.google.com/maps?q=${lat},${lng}`
      const caption = inner.liveLocationMessage.caption || 'Ubicación en tiempo real'
      return { text: `📍 ${caption}: ${link}`, locationLink: link }
    }
  }

  const text = (
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.imageMessage?.caption ||
    inner.videoMessage?.caption ||
    inner.buttonsResponseMessage?.selectedDisplayText ||
    inner.listResponseMessage?.title ||
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

class WhatsAppBaileysManager {
  private sessions = new Map<string, ManagedSession>()
  private logger = pino({ level: 'silent' })

  private getSessionDir(businessId: string): string {
    const safeId = businessId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(SESSIONS_ROOT, safeId)
  }

  public hasSavedCredentials(businessId: string): boolean {
    try {
      const credsFile = path.join(this.getSessionDir(businessId), 'creds.json')
      return fs.existsSync(credsFile)
    } catch {
      return false
    }
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
      }
      this.sessions.set(businessId, session)
    }
    return session
  }

  public getState(businessId: string): BaileysBusinessState {
    const session = this.getOrCreateSession(businessId)
    // Si hay credenciales en disco y está desconectado sin desconexión manual, reconectar en segundo plano
    if (
      session.state.status === 'disconnected' &&
      !session.isConnecting &&
      !session.manualDisconnect &&
      this.hasSavedCredentials(businessId)
    ) {
      void this.connect(businessId)
    }
    return session.state
  }

  private async persistConnectionState(session: ManagedSession) {
    session.state.updatedAtMillis = Date.now()
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

  public async connect(businessId: string): Promise<BaileysBusinessState> {
    const session = this.getOrCreateSession(businessId)
    session.manualDisconnect = false

    if (session.isConnecting || session.state.status === 'connected') {
      return session.state
    }

    session.isConnecting = true
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer)
      session.reconnectTimer = null
    }

    session.state.status = 'connecting'
    session.state.lastError = null
    await this.persistConnectionState(session)

    try {
      const sessionDir = this.getSessionDir(businessId)
      fs.mkdirSync(sessionDir, { recursive: true })

      const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
      let version: [number, number, number] = [2, 3000, 1017531287]
      try {
        const latest = await fetchLatestBaileysVersion()
        if (latest?.version) version = latest.version
      } catch {
        // Usar versión por defecto si falla la consulta
      }

      const sock = makeWASocket({
        version,
        auth: state,
        logger: this.logger as any,
        printQRInTerminal: false,
        browser: ['Fuddi Tienda', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
      })

      session.socket = sock
      this.setupFirestoreListeners(session)

      sock.ev.on('creds.update', saveCreds)

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr, {
              margin: 2,
              width: 280,
              color: { dark: '#0f172a', light: '#ffffff' },
            })
            session.state.status = 'qr'
            session.state.qrDataUrl = qrDataUrl
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
            try {
              fs.rmSync(this.getSessionDir(businessId), { recursive: true, force: true })
            } catch {
              // Ignorar error limpiando carpeta
            }
            session.state.status = 'disconnected'
            session.state.qrDataUrl = null
            session.state.connectedPhone = null
            session.state.connectedName = null
            session.state.lastError = 'Sesión cerrada desde el teléfono'
            await this.persistConnectionState(session)
          } else if (!session.manualDisconnect) {
            session.state.status = 'connecting'
            await this.persistConnectionState(session)
            session.reconnectTimer = setTimeout(() => {
              void this.connect(businessId)
            }, 3500)
          } else {
            session.state.status = 'disconnected'
            session.state.qrDataUrl = null
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
        fs.rmSync(this.getSessionDir(businessId), { recursive: true, force: true })
      } catch {
        // Ignorar
      }
    }

    session.state.status = 'disconnected'
    session.state.qrDataUrl = null
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

    // Si es un LID (@lid), intentar usar senderPn si viene en el mensaje
    const altParticipant = (msg.key as any)?.senderPn || msg.participant || ''
    const phoneSource = remoteJid.endsWith('@s.whatsapp.net')
      ? remoteJid.split('@')[0]
      : altParticipant.split('@')[0] || remoteJid.split('@')[0]

    const normPhone = normalizeEcuadorPhone(phoneSource)
    if (normPhone.length < 9) return
    if (session.excludedPhones.has(normPhone)) return

    const { text, locationLink } = extractMessageContent(msg)
    if (!text) return

    const msgId = msg.key?.id || `msg_${Date.now()}`
    if (session.sentByBridgeMsgIds.has(msgId)) return

    const rawTs = Number(msg.messageTimestamp || 0)
    const msgMillis = rawTs > 0 ? (rawTs < 10_000_000_000 ? rawTs * 1000 : rawTs) : Date.now()
    const fromMe = Boolean(msg.key?.fromMe)

    const db = ensureAdminDb()
    if (!db) return

    const convId = `phone:${normPhone}`
    const docId = `phone_${normPhone}`
    const docRef = db
      .collection('businesses')
      .doc(session.businessId)
      .collection('whatsappPending')
      .doc(docId)

    const existingSnap = await docRef.get()
    const existing = existingSnap.exists ? existingSnap.data() || {} : null

    if (fromMe) {
      // Si el mensaje lo envió la tienda desde el celular o WhatsApp Web, agregarlo a sentReplies
      // solo si la conversación ya existe, sin alterar el timestamp de actividad del cliente
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
        },
      ].slice(-24)
      await docRef.set(
        {
          sentReplies: nextReplies,
          chatHistory: nextHistory,
          canReplyDirectly: true,
        },
        { merge: true }
      )
      return
    }

    // Mensaje entrante del cliente
    const pushName = String(msg.pushName || '').trim()
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
      // Si ya tiene un pedido confirmado hoy, se mantiene en confirmed y sigue visible con el nuevo mensaje
      nextStatus = 'confirmed'
    } else if (prevStatus === 'closed') {
      // Si estaba archivado y el cliente vuelve a escribir, revive como pending
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
      },
    ].slice(-24)

    await docRef.set(
      {
        id: convId,
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
    if (session.state.status !== 'connected' || !session.socket) {
      return { ok: false, error: 'WhatsApp no está conectado como dispositivo vinculado' }
    }

    const jid = ecuadorPhoneToJid(phone)
    if (!jid) return { ok: false, error: 'Número de teléfono inválido' }

    const db = ensureAdminDb()

    try {
      session.processedReplyIds.add(replyId)
      const sentMsg = await session.socket.sendMessage(jid, { text: cleanText })
      if (sentMsg?.key?.id) {
        session.sentByBridgeMsgIds.add(sentMsg.key.id)
      }

      if (db && docId) {
        const docRef = db
          .collection('businesses')
          .doc(businessId)
          .collection('whatsappPending')
          .doc(docId)
        const snap = await docRef.get()
        const data = snap.exists ? snap.data() || {} : {}
        const currentReplies: any[] = Array.isArray(data.sentReplies) ? data.sentReplies : []
        const nextReplies = [
          ...currentReplies.filter((r) => r?.id !== replyId),
          {
            id: replyId,
            text: cleanText,
            timestampMillis: Date.now(),
            source: 'baileys',
          },
        ].slice(-MAX_RECENT_MESSAGES)

        const currentHistory: any[] = Array.isArray(data.chatHistory) ? data.chatHistory : []
        const nowOut = Date.now()
        const nextHistory = [
          ...currentHistory.filter((h) => h?.id !== replyId),
          {
            id: replyId,
            text: cleanText,
            timestampMillis: nowOut,
            fromMe: true,
            source: 'baileys',
          },
        ].slice(-24)

        await docRef.set(
          {
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
