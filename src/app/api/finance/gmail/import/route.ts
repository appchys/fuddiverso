import { NextRequest, NextResponse } from 'next/server'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { inflateRawSync } from 'zlib'
import {
  getGmailConnection,
  parsePurchaseXml,
  refreshAccessToken,
  requireFinanceAuth
} from '@/lib/finance-gmail'
import { ensureAdminDb } from '@/lib/firebase-admin'

interface GmailMessageListItem {
  id: string
  threadId: string
}

interface GmailMessagePart {
  filename?: string
  mimeType?: string
  body?: {
    attachmentId?: string
    data?: string
  }
  parts?: GmailMessagePart[]
}

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf-8')
}

const findXmlParts = (part?: GmailMessagePart): GmailMessagePart[] => {
  if (!part) return []

  const fileName = part.filename?.toLowerCase() || ''
  const ownPart = fileName.endsWith('.xml') || fileName.endsWith('.zip') ? [part] : []
  const childParts = part.parts?.flatMap(findXmlParts) || []
  return [...ownPart, ...childParts]
}

const readUInt16LE = (buffer: Buffer, offset: number) => buffer.readUInt16LE(offset)
const readUInt32LE = (buffer: Buffer, offset: number) => buffer.readUInt32LE(offset)

const findEndOfCentralDirectory = (buffer: Buffer) => {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22)
  for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
    if (readUInt32LE(buffer, offset) === 0x06054b50) return offset
  }
  return -1
}

const extractXmlFromZip = (zipBuffer: Buffer) => {
  const xmlDocuments: Array<{ filename: string; xml: string }> = []
  const eocdOffset = findEndOfCentralDirectory(zipBuffer)
  if (eocdOffset < 0) return xmlDocuments

  const totalEntries = readUInt16LE(zipBuffer, eocdOffset + 10)
  const centralDirectoryOffset = readUInt32LE(zipBuffer, eocdOffset + 16)
  let offset = centralDirectoryOffset

  for (let index = 0; index < totalEntries; index++) {
    if (readUInt32LE(zipBuffer, offset) !== 0x02014b50) break

    const compressionMethod = readUInt16LE(zipBuffer, offset + 10)
    const compressedSize = readUInt32LE(zipBuffer, offset + 20)
    const fileNameLength = readUInt16LE(zipBuffer, offset + 28)
    const extraLength = readUInt16LE(zipBuffer, offset + 30)
    const commentLength = readUInt16LE(zipBuffer, offset + 32)
    const localHeaderOffset = readUInt32LE(zipBuffer, offset + 42)
    const filename = zipBuffer.toString('utf-8', offset + 46, offset + 46 + fileNameLength)

    offset += 46 + fileNameLength + extraLength + commentLength

    if (!filename.toLowerCase().endsWith('.xml')) continue
    if (readUInt32LE(zipBuffer, localHeaderOffset) !== 0x04034b50) continue

    const localFileNameLength = readUInt16LE(zipBuffer, localHeaderOffset + 26)
    const localExtraLength = readUInt16LE(zipBuffer, localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength
    const compressedData = zipBuffer.subarray(dataStart, dataStart + compressedSize)

    let xmlBuffer: Buffer | null = null
    if (compressionMethod === 0) {
      xmlBuffer = compressedData
    } else if (compressionMethod === 8) {
      xmlBuffer = inflateRawSync(compressedData)
    }

    if (xmlBuffer) {
      xmlDocuments.push({
        filename,
        xml: xmlBuffer.toString('utf-8')
      })
    }
  }

  return xmlDocuments
}

const getXmlDocumentsFromAttachment = (filename: string | undefined, decodedBytes: Buffer) => {
  const lowerFilename = filename?.toLowerCase() || ''

  if (lowerFilename.endsWith('.zip')) {
    return extractXmlFromZip(decodedBytes)
  }

  return [{
    filename: filename || 'factura.xml',
    xml: decodedBytes.toString('utf-8')
  }]
}

const gmailFetch = async (accessToken: string, path: string) => {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error?.message || 'No se pudo consultar Gmail.')
  }

  return data
}

const gmailPost = async (accessToken: string, path: string, body: any) => {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error?.message || 'No se pudo actualizar Gmail.')
  }

  return data
}

const getOrCreateImportedLabel = async (accessToken: string) => {
  const labels = await gmailFetch(accessToken, 'labels') as { labels?: Array<{ id: string; name: string }> }
  const existing = labels.labels?.find(label => label.name.toLowerCase() === 'importado')

  if (existing?.id) return existing.id

  const created = await gmailPost(accessToken, 'labels', {
    name: 'Importado',
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show'
  }) as { id: string }

  return created.id
}

const hasDuplicateExpense = async (
  adminDb: Firestore,
  businessId: string,
  sourceFingerprint: string,
  xmlAuthorization?: string | null
) => {
  const sourceDuplicate = await adminDb.collection('expenses')
    .where('businessId', '==', businessId)
    .where('sourceFingerprint', '==', sourceFingerprint)
    .limit(1)
    .get()

  if (!sourceDuplicate.empty) return true

  if (!xmlAuthorization) return false

  const xmlDuplicate = await adminDb.collection('expenses')
    .where('businessId', '==', businessId)
    .where('xmlAuthorization', '==', xmlAuthorization)
    .limit(1)
    .get()

  return !xmlDuplicate.empty
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireFinanceAuth(request)
    if (context instanceof NextResponse) return context

    const adminDb = ensureAdminDb()
    if (!adminDb) {
      return NextResponse.json({ error: 'Firebase Admin no esta configurado.' }, { status: 500 })
    }

    const connection = await getGmailConnection(context.businessId)
    if (!connection?.refreshToken) {
      return NextResponse.json({ error: 'Primero conecta una cuenta de Gmail.' }, { status: 400 })
    }

    if (!Array.isArray(connection.scopes) || !connection.scopes.includes('https://www.googleapis.com/auth/gmail.modify')) {
      return NextResponse.json({
        error: 'Reconecta Gmail para permitir etiquetar correos como Importado.'
      }, { status: 400 })
    }

    const accessToken = await refreshAccessToken(connection.refreshToken)
    const importedLabelId = await getOrCreateImportedLabel(accessToken)
    const query = encodeURIComponent('has:attachment newer_than:90d (filename:xml OR filename:zip) -label:Importado')
    const list = await gmailFetch(accessToken, `messages?q=${query}&maxResults=25`) as { messages?: GmailMessageListItem[] }
    const messages = list.messages || []
    const imported: any[] = []
    let skipped = 0
    let labeled = 0

    for (const message of messages) {
      const fullMessage = await gmailFetch(accessToken, `messages/${message.id}?format=full`)
      const xmlParts = findXmlParts(fullMessage.payload)
      let shouldLabelMessage = false

      for (const part of xmlParts) {
        const attachmentId = part.body?.attachmentId
        const sourceFingerprint = `gmail:${message.id}:${attachmentId || part.filename}`

        let attachmentBytes: Buffer | null = null
        if (attachmentId) {
          const attachment = await gmailFetch(accessToken, `messages/${message.id}/attachments/${attachmentId}`)
          attachmentBytes = Buffer.from((attachment.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        } else if (part.body?.data) {
          attachmentBytes = Buffer.from(part.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        }

        if (!attachmentBytes || attachmentBytes.length === 0) {
          skipped++
          continue
        }

        const xmlDocuments = getXmlDocumentsFromAttachment(part.filename, attachmentBytes)

        for (const xmlDocument of xmlDocuments) {
          if (!xmlDocument.xml.trim()) {
            skipped++
            continue
          }

          const purchase = parsePurchaseXml(xmlDocument.xml)
          if (!purchase.amount || purchase.amount <= 0) {
            skipped++
            continue
          }

          const documentFingerprint = `${sourceFingerprint}:${xmlDocument.filename}`
          const duplicate = await hasDuplicateExpense(
            adminDb,
            context.businessId,
            documentFingerprint,
            purchase.authorization
          )

          if (duplicate) {
            shouldLabelMessage = true
            skipped++
            continue
          }

          const expense = {
            businessId: context.businessId,
            date: purchase.date,
            concept: `Compra XML - ${purchase.supplier}`,
            amount: purchase.amount,
            paymentMethod: 'transfer',
            paymentStatus: 'paid',
            registeredBy: 'Importador Gmail',
            registeredById: context.uid,
            source: 'gmail_xml',
            sourceFingerprint: documentFingerprint,
            gmailMessageId: message.id,
            gmailAttachmentId: attachmentId || null,
            gmailAttachmentName: part.filename || null,
            xmlFilename: xmlDocument.filename,
            xmlAuthorization: purchase.authorization,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
          }

          const docRef = await adminDb.collection('expenses').add(expense)
          imported.push({
            id: docRef.id,
            concept: expense.concept,
            amount: expense.amount,
            date: expense.date
          })
          shouldLabelMessage = true
        }
      }

      if (shouldLabelMessage) {
        await gmailPost(accessToken, `messages/${message.id}/modify`, {
          addLabelIds: [importedLabelId]
        })
        labeled++
      }
    }

    await adminDb.collection('financeIntegrations').doc(context.businessId).set({
      lastImportAt: FieldValue.serverTimestamp(),
      lastImportCount: imported.length,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true })

    return NextResponse.json({
      ok: true,
      importedCount: imported.length,
      skippedCount: skipped,
      labeledCount: labeled,
      scannedMessages: messages.length,
      imported
    })
  } catch (error: any) {
    console.error('[finance/gmail/import] Error:', error)
    return NextResponse.json({ error: error.message || 'No se pudieron importar compras.' }, { status: 500 })
  }
}
