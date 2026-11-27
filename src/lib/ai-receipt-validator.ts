import { ensureAdminDb } from '@/lib/firebase-admin'
import type { ChatImageCategory, ChatImageClassification, PaymentAiValidation } from '@/types'

const IMAGE_CATEGORY_LABELS: Record<ChatImageCategory, string> = {
  receipt: 'Comprobante de transferencia',
  location_reference: 'Referencia de ubicación',
  product_capture: 'Captura de producto',
  order_capture: 'Captura de orden',
  other: 'Imagen',
}

const MAX_RECEIPT_IMAGE_BYTES = 4 * 1024 * 1024

const FUDDI_OFFICIAL_ACCOUNTS = [
  {
    bankName: 'Banco Pichincha',
    accountNumber: '2203257517',
    accountHolder: 'Pedro Sánchez León',
    idNumber: '0929057636',
  },
  {
    bankName: 'Banco del Pacífico',
    accountNumber: '1063889358',
    accountHolder: 'Pedro Sánchez León',
    idNumber: '0929057636',
  },
  {
    bankName: 'Banco Guayaquil',
    accountNumber: '0030697477',
    accountHolder: 'Pedro Sánchez León',
    idNumber: '0929057636',
  },
  {
    bankName: 'Banco Produbanco',
    accountNumber: '20059842774',
    accountHolder: 'Pedro Sánchez León',
    idNumber: '0929057636',
  },
]

async function downloadImageAsBase64(
  url: string
): Promise<{ mimeType: string; base64: string } | null> {
  if (!/^https?:\/\//i.test(url)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) return null
    const rawMime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const mimeType = rawMime.startsWith('image/') ? rawMime : 'image/jpeg'
    const len = Number(res.headers.get('content-length') || 0)
    if (len > MAX_RECEIPT_IMAGE_BYTES) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0 || buf.byteLength > MAX_RECEIPT_IMAGE_BYTES) return null
    return { mimeType, base64: Buffer.from(buf).toString('base64') }
  } catch (err) {
    console.warn('[AI Receipt Validator] Error descargando imagen:', err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

function getValidAccountsForBusiness(bizData: Record<string, any>): Array<{
  bankName: string
  accountNumber: string
  accountHolder: string
  idNumber?: string
}> {
  if (bizData?.bankAccountMode === 'custom') {
    if (Array.isArray(bizData.bankAccounts) && bizData.bankAccounts.length > 0) {
      return bizData.bankAccounts
        .filter((a: any) => a?.accountNumber)
        .map((a: any) => ({
          bankName: String(a.bankName || '').trim(),
          accountNumber: String(a.accountNumber || '').trim(),
          accountHolder: String(a.accountHolder || '').trim(),
          idNumber: a.idNumber ? String(a.idNumber).trim() : undefined,
        }))
    }
    if (bizData.bankAccount?.accountNumber) {
      return [
        {
          bankName: String(bizData.bankAccount.bankName || '').trim(),
          accountNumber: String(bizData.bankAccount.accountNumber || '').trim(),
          accountHolder: String(bizData.bankAccount.accountHolder || '').trim(),
          idNumber: bizData.bankAccount.idNumber ? String(bizData.bankAccount.idNumber).trim() : undefined,
        },
      ]
    }
  }
  return FUDDI_OFFICIAL_ACCOUNTS
}

function normalizePhoneDigits(raw?: string): string {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.startsWith('593') && digits.length >= 11) return '0' + digits.slice(3)
  if (digits.startsWith('9') && digits.length === 9) return '0' + digits
  return digits
}

export interface AnalyzedChatImageResult {
  classification: ChatImageClassification
  receiptValidation?: PaymentAiValidation
}

export async function analyzeChatImage(params: {
  businessId: string
  imageUrl: string
  expectedAmount?: number | null
  source?: 'whatsapp' | 'instagram' | 'checkout' | 'manual'
  excludeOrderId?: string
}): Promise<AnalyzedChatImageResult | null> {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim()
  if (!apiKey || !params.imageUrl) return null

  const img = await downloadImageAsBase64(params.imageUrl)
  if (!img) return null

  const db = ensureAdminDb()
  let bizData: Record<string, any> = {}
  if (db && params.businessId) {
    const bizSnap = await db.collection('businesses').doc(params.businessId).get().catch(() => null)
    if (bizSnap?.exists) bizData = bizSnap.data() || {}
  }

  const validAccounts = getValidAccountsForBusiness(bizData)
  const accountsText = validAccounts
    .map(
      (a) =>
        `- Banco: ${a.bankName} | Cuenta: ${a.accountNumber} | Titular: ${a.accountHolder}${
          a.idNumber ? ` | CI/RUC: ${a.idNumber}` : ''
        }`
    )
    .join('\n')

  const todayEc = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const prompt = [
    'Eres un clasificador y auditor estricto de imágenes enviadas por clientes a una tienda de comida/delivery en Ecuador.',
    'Analiza la imagen adjunta y responde ÚNICAMENTE con un objeto JSON válido (sin markdown ni texto adicional).',
    '',
    'Clasifica la imagen en EXACTAMENTE una de estas categorías ("imageCategory"):',
    '1. "receipt": Comprobante o captura de transferencia bancaria / Deuna! / pago móvil.',
    '2. "location_reference": Foto de fachada de casa, edificio, calle, negocio cercano o captura de mapa/Google Maps para indicar una ubicación de entrega.',
    '3. "product_capture": Captura de pantalla o foto de un producto del catálogo, menú, plato o historia/post de Instagram/redes.',
    '4. "order_capture": Captura de pantalla del resumen/confirmación de una orden o carrito de pedido recién realizado.',
    '5. "other": Cualquier otra imagen que no encaje en las 4 anteriores.',
    '',
    `Fecha actual en Ecuador: ${todayEc}`,
    params.expectedAmount && params.expectedAmount > 0
      ? `Monto esperado si fuera transferencia: $${params.expectedAmount.toFixed(2)}`
      : 'Monto esperado si fuera transferencia: no especificado todavía.',
    'Cuentas destino válidas para esta tienda (solo aplica si imageCategory == "receipt"):',
    accountsText,
    '',
    'Devuelve exactamente este JSON:',
    '{',
    '  "imageCategory": "receipt|location_reference|product_capture|order_capture|other",',
    '  "shortSummary": "descripción muy corta en español (máx 10 palabras) de lo que se ve en la imagen",',
    '  "isReceipt": true/false,',
    '  "amount": numero_o_null,',
    '  "bankName": "nombre del banco o app (ej. Banco Pichincha, Deuna!, Banco Guayaquil) o null",',
    '  "destinationAccount": "últimos dígitos o número de cuenta destino visible o null",',
    '  "destinationHolder": "nombre del beneficiario/titular visible o null",',
    '  "referenceNumber": "número de comprobante/transacción/documento visible o null",',
    '  "dateStr": "fecha visible en el comprobante o null",',
    '  "accountMatches": true/false/null,',
    '  "isRecentDate": true/false/null,',
    '  "reasons": ["lista corta de observaciones o problemas detectados si es comprobante"]',
    '}',
    '',
    'Reglas estrictas:',
    '- Si imageCategory es "receipt", pon "isReceipt": true y completa los campos bancarios.',
    '- Si imageCategory NO es "receipt", pon "isReceipt": false y deja los campos bancarios en null.',
    '- accountMatches debe ser true si la cuenta o el titular destino coincide con alguna de las cuentas válidas listadas arriba (incluso si el banco enmascara dígitos como ****7517); false si claramente pertenece a OTRA persona/cuenta distinta; null si el comprobante no muestra cuenta ni titular destino.',
    '- isRecentDate debe ser true si la fecha es de hoy o ayer; false si es de hace varios días/meses; null si no se ve fecha.',
  ].join('\n')

  const candidateModels = Array.from(
    new Set(
      [
        (process.env.GEMINI_MODEL || '').trim(),
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite',
        'gemini-flash-latest',
      ].filter(Boolean)
    )
  )

  let parsed: Record<string, any> | null = null
  let usedModel = ''

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 18_000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                { inline_data: { mime_type: img.mimeType, data: img.base64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 512,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: controller.signal,
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404 || res.status === 429 || res.status === 503) continue
        break
      }

      const rawText = (data?.candidates?.[0]?.content?.parts || [])
        .map((p: any) => String(p?.text || ''))
        .join('')
        .trim()
      if (!rawText) continue

      const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
      parsed = JSON.parse(cleanJson)
      usedModel = model
      break
    } catch (err) {
      console.warn(`[AI Receipt Validator] Error con ${model}:`, err)
    } finally {
      clearTimeout(timer)
    }
  }

  if (!parsed) return null

  const rawCat = String(parsed.imageCategory || '').trim()
  const validCategories: ChatImageCategory[] = [
    'receipt',
    'location_reference',
    'product_capture',
    'order_capture',
    'other',
  ]
  const category: ChatImageCategory = validCategories.includes(rawCat as ChatImageCategory)
    ? (rawCat as ChatImageCategory)
    : parsed.isReceipt === true
    ? 'receipt'
    : 'other'

  const shortSummary =
    typeof parsed.shortSummary === 'string' && parsed.shortSummary.trim()
      ? parsed.shortSummary.trim().slice(0, 120)
      : undefined

  const classification: ChatImageClassification = {
    category,
    label: IMAGE_CATEGORY_LABELS[category],
    ...(shortSummary ? { summary: shortSummary } : {}),
    analyzedAtMillis: Date.now(),
    model: usedModel,
  }

  const isReceipt = category === 'receipt' || parsed.isReceipt === true
  if (!isReceipt) {
    return { classification }
  }

  const amount =
    typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) && parsed.amount > 0
      ? Math.round(parsed.amount * 100) / 100
      : null
  const bankName = typeof parsed.bankName === 'string' && parsed.bankName.trim() ? parsed.bankName.trim() : null
  const destinationAccount =
    typeof parsed.destinationAccount === 'string' && parsed.destinationAccount.trim()
      ? parsed.destinationAccount.trim()
      : null
  const destinationHolder =
    typeof parsed.destinationHolder === 'string' && parsed.destinationHolder.trim()
      ? parsed.destinationHolder.trim()
      : null
  const referenceNumber =
    typeof parsed.referenceNumber === 'string' && parsed.referenceNumber.trim()
      ? parsed.referenceNumber.trim()
      : null
  const dateStr = typeof parsed.dateStr === 'string' && parsed.dateStr.trim() ? parsed.dateStr.trim() : null
  const reasons: string[] = Array.isArray(parsed.reasons)
    ? parsed.reasons.map((r: any) => String(r || '').trim()).filter(Boolean)
    : []

  // Verificar duplicado por número de comprobante en órdenes de la tienda
  let isDuplicate = false
  if (db && params.businessId && referenceNumber && referenceNumber.length >= 4) {
    try {
      const dupSnap = await db
        .collection('orders')
        .where('businessId', '==', params.businessId)
        .where('payment.aiValidation.referenceNumber', '==', referenceNumber)
        .limit(3)
        .get()
      isDuplicate = dupSnap.docs.some((d) => d.id !== params.excludeOrderId)
      if (isDuplicate) {
        reasons.push(`Comprobante duplicado (nro. ${referenceNumber} ya registrado anteriormente).`)
      }
    } catch {
      // Si falta índice compuesto, no bloquear la validación
    }
  }

  // Evaluar estado final
  let status: 'pre_validated' | 'validating' | 'rejected' = 'pre_validated'

  if (isDuplicate) {
    status = 'rejected'
  } else if (parsed.accountMatches === false) {
    status = 'rejected'
    if (!reasons.some((r) => r.toLowerCase().includes('cuenta') || r.toLowerCase().includes('titular'))) {
      reasons.push('La cuenta o titular destino no coincide con las cuentas registradas.')
    }
  } else if (parsed.isRecentDate === false) {
    status = 'rejected'
    if (!reasons.some((r) => r.toLowerCase().includes('fecha'))) {
      reasons.push(`La fecha del comprobante (${dateStr || 'antigua'}) no es reciente.`)
    }
  } else if (
    params.expectedAmount &&
    params.expectedAmount > 0 &&
    amount !== null &&
    amount + 0.02 < params.expectedAmount
  ) {
    status = 'rejected'
    reasons.push(
      `Monto insuficiente: el comprobante es de $${amount.toFixed(2)} y el esperado es $${params.expectedAmount.toFixed(2)}.`
    )
  } else if (amount === null || parsed.accountMatches === null) {
    status = 'validating'
    if (amount === null) reasons.push('No se pudo leer con claridad el monto del comprobante.')
    if (parsed.accountMatches === null) reasons.push('Verificar cuenta destino manualmente.')
  }

  const summaryParts: string[] = []
  if (amount !== null) summaryParts.push(`$${amount.toFixed(2)}`)
  if (bankName) summaryParts.push(bankName)
  if (referenceNumber) summaryParts.push(`Ref. ${referenceNumber}`)
  const summary =
    status === 'pre_validated'
      ? `Pre-validado por IA${summaryParts.length ? ` (${summaryParts.join(' · ')})` : ''}`
      : status === 'rejected'
      ? `Observación de IA: ${reasons[0] || 'Comprobante con inconsistencias'}`
      : `Requiere revisión manual${summaryParts.length ? ` (${summaryParts.join(' · ')})` : ''}`

  return {
    classification,
    receiptValidation: {
      status,
      isReceipt: true,
      amount,
      bankName,
      destinationAccount,
      destinationHolder,
      referenceNumber,
      dateStr,
      summary,
      reasons,
      isDuplicate,
      validatedByAi: true,
      validatedAtMillis: Date.now(),
      model: usedModel,
      source: params.source,
    },
  }
}

export async function validateTransferReceiptImage(params: {
  businessId: string
  imageUrl: string
  expectedAmount?: number | null
  source?: 'whatsapp' | 'instagram' | 'checkout' | 'manual'
  excludeOrderId?: string
}): Promise<PaymentAiValidation | null> {
  const analyzed = await analyzeChatImage(params)
  return analyzed?.receiptValidation || null
}

/**
 * Procesa una imagen recibida en el chat (WhatsApp o Instagram):
 * 1. Evalúa si es un comprobante de transferencia con el validador de IA.
 * 2. Si es un comprobante, lo adjunta automáticamente a la orden activa reciente del cliente
 *    (en `payment.receiptImageUrl`, `payment.paymentStatus` y `payment.aiValidation`)
 *    y también en `whatsappPending/{docId}.receiptAttachment` si aún está en preorden.
 * 3. Devuelve un texto breve con el veredicto para que el agente del chat responda con exactitud.
 */
export async function processChatImageReceiptForBusiness(params: {
  businessId: string
  docId: string
  imageUrl: string
  channel: 'whatsapp' | 'instagram'
  customerPhone?: string
  customerClientId?: string
  existingPreorderState?: Record<string, any> | null
}): Promise<{ validation: PaymentAiValidation; linkedOrderId?: string; chatContextNote: string } | null> {
  const db = ensureAdminDb()
  if (!db || !params.businessId || !params.imageUrl) return null

  // 1. Buscar si existe una orden reciente (últimas 36 horas) sin pagar para este cliente en esta tienda
  let matchedOrderDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null
  const cleanPhone = normalizePhoneDigits(params.customerPhone)
  const cutoffMs = Date.now() - 36 * 60 * 60 * 1000

  try {
    const ordersSnap = await db
      .collection('orders')
      .where('businessId', '==', params.businessId)
      .orderBy('createdAt', 'desc')
      .limit(25)
      .get()

    for (const d of ordersSnap.docs) {
      const o = d.data() || {}
      if (o.status === 'cancelled') continue
      const method = o.payment?.method
      if (method !== 'transfer' && method !== 'mixed') continue
      if (o.payment?.paymentStatus === 'paid') continue

      const createdAtMs =
        typeof o.createdAt?.toMillis === 'function'
          ? o.createdAt.toMillis()
          : typeof o.createdAt?.seconds === 'number'
          ? o.createdAt.seconds * 1000
          : Date.now()
      if (createdAtMs < cutoffMs) continue

      const orderPhone = normalizePhoneDigits(o.customer?.phone)
      const orderClientId = String(o.customer?.id || '').trim()
      const matchesClient =
        (params.customerClientId && orderClientId && orderClientId === params.customerClientId) ||
        (cleanPhone.length >= 9 && orderPhone === cleanPhone)

      if (matchesClient) {
        matchedOrderDoc = d
        break
      }
    }
  } catch (err) {
    console.warn('[AI Receipt Validator] Error buscando orden activa del cliente:', err)
  }

  // Determinar monto esperado desde la orden activa o desde la preorden del chat
  let expectedAmount: number | null = null
  if (matchedOrderDoc) {
    const o = matchedOrderDoc.data() || {}
    if (o.payment?.method === 'mixed' && Number(o.payment?.transferAmount) > 0) {
      expectedAmount = Number(o.payment.transferAmount)
    } else if (Number(o.total) > 0) {
      expectedAmount = Number(o.total)
    }
  } else if (params.existingPreorderState) {
    const ps = params.existingPreorderState
    if (ps.paymentMethod === 'mixed' && Number(ps.transferAmountInput) > 0) {
      expectedAmount = Number(ps.transferAmountInput)
    } else if (Array.isArray(ps.items) && ps.items.length > 0) {
      const sub = ps.items.reduce(
        (acc: number, it: any) => acc + Number(it?.price || 0) * Number(it?.quantity || 1),
        0
      )
      if (sub > 0) expectedAmount = sub
    }
  }

  const analyzed = await analyzeChatImage({
    businessId: params.businessId,
    imageUrl: params.imageUrl,
    expectedAmount,
    source: params.channel,
    excludeOrderId: matchedOrderDoc?.id,
  })

  if (!analyzed) return null

  const { classification, receiptValidation: validation } = analyzed
  const isReceipt = Boolean(validation?.isReceipt)

  // 2. Si es comprobante, vincular a la orden activa si existe
  let linkedOrderId: string | undefined
  if (isReceipt && validation && matchedOrderDoc) {
    linkedOrderId = matchedOrderDoc.id
    const o = matchedOrderDoc.data() || {}
    const updatePayload: Record<string, any> = {
      'payment.receiptImageUrl': params.imageUrl,
      'payment.paymentStatus': validation.status,
      'payment.aiValidation': validation,
    }
    if (validation.bankName && !o.payment?.selectedBank) {
      updatePayload['payment.selectedBank'] = validation.bankName
    }
    await matchedOrderDoc.ref.update(updatePayload).catch((err) => {
      console.warn('[AI Receipt Validator] Error vinculando comprobante a orden:', err)
    })
  }

  // 3. Guardar siempre la clasificación de la imagen en chatHistory (aunque se esté respondiendo manualmente)
  // y guardar receiptAttachment cuando sea comprobante
  if (params.docId && classification.category !== 'other') {
    const convRef = db
      .collection('businesses')
      .doc(params.businessId)
      .collection('whatsappPending')
      .doc(params.docId)

    const convSnap = await convRef.get().catch(() => null)
    const convData = convSnap?.exists ? convSnap.data() || {} : {}
    const prevHistory: any[] = Array.isArray(convData.chatHistory) ? convData.chatHistory : []
    const updatedHistory = prevHistory.map((entry) =>
      entry?.mediaUrl === params.imageUrl
        ? {
            ...entry,
            imageClassification: classification,
            ...(isReceipt && validation
              ? {
                  receiptValidation: validation,
                  linkedOrderId: linkedOrderId || null,
                }
              : {}),
          }
        : entry
    )

    await convRef
      .set(
        {
          ...(prevHistory.length > 0 ? { chatHistory: updatedHistory } : {}),
          ...(isReceipt && validation
            ? {
                receiptAttachment: {
                  imageUrl: params.imageUrl,
                  validation,
                  linkedOrderId: linkedOrderId || null,
                  receivedAtMillis: Date.now(),
                },
              }
            : {}),
        },
        { merge: true }
      )
      .catch(() => {})
  }

  if (!isReceipt || !validation) {
    if (classification.category === 'other') return null
    return {
      validation: {
        status: 'validating',
        isReceipt: false,
        validatedByAi: true,
        validatedAtMillis: classification.analyzedAtMillis,
        model: classification.model,
        source: params.channel,
      },
      chatContextNote: `IMAGEN CLASIFICADA COMO: ${classification.label}${
        classification.summary ? ` (${classification.summary})` : ''
      }`,
    }
  }

  const noteParts = [
    `RESULTADO DEL VALIDADOR DE COMPROBANTES:`,
    `- Estado: ${
      validation.status === 'pre_validated'
        ? 'PRE-VALIDADO (datos correctos)'
        : validation.status === 'rejected'
        ? 'RECHAZADO / CON OBSERVACIONES'
        : 'EN VALIDACIÓN MANUAL'
    }`,
    validation.amount != null ? `- Monto detectado: $${validation.amount.toFixed(2)}` : '',
    validation.bankName ? `- Banco: ${validation.bankName}` : '',
    validation.referenceNumber ? `- Nro. comprobante: ${validation.referenceNumber}` : '',
    validation.reasons && validation.reasons.length > 0
      ? `- Observaciones: ${validation.reasons.join(' | ')}`
      : '',
    linkedOrderId ? `- Comprobante adjuntado automáticamente a la orden activa del cliente.` : '',
  ].filter(Boolean)

  return {
    validation,
    linkedOrderId,
    chatContextNote: noteParts.join('\n'),
  }
}
