import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { createHmac, timingSafeEqual } from 'crypto'
import { ensureAdminAuth, ensureAdminDb } from '@/lib/firebase-admin'

export interface FinanceAuthContext {
  uid: string
  email?: string
  businessId: string
}

interface GmailTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  error?: string
  error_description?: string
}

export const gmailScopes = [
  'https://www.googleapis.com/auth/gmail.modify'
]

const getOAuthConfig = () => {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL

  return {
    clientId,
    clientSecret,
    redirectUri: appUrl ? `${appUrl.replace(/\/$/, '')}/api/finance/gmail/callback` : undefined,
    stateSecret: process.env.FINANCE_OAUTH_STATE_SECRET || clientSecret || process.env.FIREBASE_SERVICE_ACCOUNT_KEY || 'finance-dev-secret'
  }
}

export const getMissingGoogleOAuthConfig = () => {
  const config = getOAuthConfig()
  return [
    !config.clientId ? 'GOOGLE_GMAIL_CLIENT_ID' : null,
    !config.clientSecret ? 'GOOGLE_GMAIL_CLIENT_SECRET' : null,
    !config.redirectUri ? 'NEXT_PUBLIC_APP_URL' : null
  ].filter(Boolean) as string[]
}

export async function requireFinanceAuth(request: NextRequest): Promise<FinanceAuthContext | NextResponse> {
  const adminAuth = ensureAdminAuth()
  const adminDb = ensureAdminDb()

  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin no esta configurado.' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!token) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  const decodedToken = await adminAuth.verifyIdToken(token)
  const businessId = request.nextUrl.searchParams.get('businessId') || (await request.clone().json().catch(() => ({}))).businessId

  if (!businessId || typeof businessId !== 'string') {
    return NextResponse.json({ error: 'Negocio requerido.' }, { status: 400 })
  }

  const businessSnap = await adminDb.collection('businesses').doc(businessId).get()

  if (!businessSnap.exists) {
    return NextResponse.json({ error: 'Negocio no encontrado.' }, { status: 404 })
  }

  const business = businessSnap.data() || {}
  const requesterEmail = decodedToken.email?.toLowerCase()
  const administrators = Array.isArray(business.administrators) ? business.administrators : []
  const isAdmin = administrators.some((admin: any) => admin.email?.toLowerCase() === requesterEmail)

  if (business.ownerId !== decodedToken.uid && !isAdmin) {
    return NextResponse.json({ error: 'No tienes permiso para este negocio.' }, { status: 403 })
  }

  return {
    uid: decodedToken.uid,
    email: decodedToken.email,
    businessId
  }
}

export function createOAuthState(context: FinanceAuthContext) {
  const config = getOAuthConfig()
  const payload = Buffer.from(JSON.stringify({
    businessId: context.businessId,
    uid: context.uid,
    ts: Date.now()
  })).toString('base64url')
  const signature = createHmac('sha256', config.stateSecret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function parseOAuthState(state: string): FinanceAuthContext | null {
  const config = getOAuthConfig()
  const [payload, signature] = state.split('.')
  if (!payload || !signature) return null

  const expected = createHmac('sha256', config.stateSecret).update(payload).digest('base64url')
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null
  }

  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'))
  if (!parsed.businessId || !parsed.uid || Date.now() - parsed.ts > 10 * 60 * 1000) return null

  return {
    businessId: parsed.businessId,
    uid: parsed.uid
  }
}

export function buildGoogleAuthUrl(context: FinanceAuthContext) {
  const config = getOAuthConfig()
  const missing = getMissingGoogleOAuthConfig()
  if (missing.length > 0 || !config.clientId || !config.redirectUri) {
    throw new Error(`Faltan variables: ${missing.join(', ')}`)
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', gmailScopes.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', createOAuthState(context))
  return url.toString()
}

export async function exchangeCodeForTokens(code: string): Promise<GmailTokenResponse> {
  const config = getOAuthConfig()
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new Error('OAuth de Google no esta configurado.')
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code'
    })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'No se pudo conectar Gmail.')
  }

  return data
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const config = getOAuthConfig()
  if (!config.clientId || !config.clientSecret) {
    throw new Error('OAuth de Google no esta configurado.')
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  })

  const data = await response.json()
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'No se pudo refrescar Gmail.')
  }

  return data.access_token
}

export async function saveGmailConnection(context: FinanceAuthContext, tokens: GmailTokenResponse) {
  const adminDb = ensureAdminDb()
  if (!adminDb || !tokens.refresh_token) {
    throw new Error('No se recibio permiso persistente de Gmail.')
  }

  await adminDb.collection('financeIntegrations').doc(context.businessId).set({
    businessId: context.businessId,
    provider: 'gmail',
    status: 'connected',
    connectedBy: context.uid,
    connectedEmail: context.email || null,
    refreshToken: tokens.refresh_token,
    scopes: gmailScopes,
    updatedAt: FieldValue.serverTimestamp(),
    connectedAt: FieldValue.serverTimestamp()
  }, { merge: true })
}

export async function getGmailConnection(businessId: string) {
  const adminDb = ensureAdminDb()
  if (!adminDb) return null

  const snap = await adminDb.collection('financeIntegrations').doc(businessId).get()
  if (!snap.exists) return null

  return {
    id: snap.id,
    ...snap.data()
  } as any
}

export function parsePurchaseXml(xml: string) {
  const text = xml.includes('&lt;') ? xml.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : xml
  const readTag = (tag: string) => {
    const match = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
    return match?.[1]?.replace(/<!\\[CDATA\\[|\\]\\]>/g, '').trim()
  }

  const supplier = readTag('razonSocial') || readTag('nombreComercial') || readTag('razonSocialComprador') || 'Proveedor XML'
  const total = Number.parseFloat(readTag('importeTotal') || readTag('totalSinImpuestos') || '0')
  const issueDate = readTag('fechaEmision')
  const date = issueDate?.includes('/')
    ? issueDate.split('/').reverse().join('-')
    : issueDate || new Date().toISOString().split('T')[0]
  const authorization = readTag('numeroAutorizacion') || readTag('claveAcceso') || null

  return {
    supplier,
    amount: Number.isFinite(total) ? total : 0,
    date,
    authorization
  }
}
