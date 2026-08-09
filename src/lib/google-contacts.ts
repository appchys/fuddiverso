import { FieldValue } from 'firebase-admin/firestore'
import { createHmac, timingSafeEqual } from 'crypto'
import { ensureAdminDb } from '@/lib/firebase-admin'

export const contactsScopes = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.email'
]

export const TARGET_CENTRAL_EMAIL = 'munchys.ec@gmail.com'

export function getContactsOAuthConfig() {
  const rawClientId = process.env.GOOGLE_CONTACTS_CLIENT_ID || process.env.GOOGLE_GMAIL_CLIENT_ID || ''
  const rawClientSecret = process.env.GOOGLE_CONTACTS_CLIENT_SECRET || process.env.GOOGLE_GMAIL_CLIENT_SECRET || ''

  const clientId = rawClientId.trim().replace(/^["']|["']$/g, '')
  const clientSecret = rawClientSecret.trim().replace(/^["']|["']$/g, '')
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000').trim().replace(/^["']|["']$/g, '')

  const cleanAppUrl = appUrl.replace(/\/$/, '')

  return {
    clientId,
    clientSecret,
    redirectUri: `${cleanAppUrl}/api/google-contacts/callback`,
    stateSecret: process.env.FINANCE_OAUTH_STATE_SECRET || clientSecret || process.env.FIREBASE_SERVICE_ACCOUNT_KEY || 'contacts-secret'
  }
}

export function getMissingContactsOAuthConfig(): string[] {
  const config = getContactsOAuthConfig()
  return [
    !config.clientId ? 'GOOGLE_CONTACTS_CLIENT_ID (o GOOGLE_GMAIL_CLIENT_ID)' : null,
    !config.clientSecret ? 'GOOGLE_CONTACTS_CLIENT_SECRET (o GOOGLE_GMAIL_CLIENT_SECRET)' : null,
    !config.redirectUri ? 'NEXT_PUBLIC_APP_URL' : null
  ].filter(Boolean) as string[]
}

export function createContactsOAuthState(payloadData: any = {}) {
  const config = getContactsOAuthConfig()
  const payload = Buffer.from(JSON.stringify({
    ...payloadData,
    ts: Date.now()
  })).toString('base64url')
  const signature = createHmac('sha256', config.stateSecret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function parseContactsOAuthState(state: string): any | null {
  const config = getContactsOAuthConfig()
  const [payload, signature] = state.split('.')
  if (!payload || !signature) return null

  const expected = createHmac('sha256', config.stateSecret).update(payload).digest('base64url')
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null
  }

  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'))
  if (Date.now() - parsed.ts > 15 * 60 * 1000) return null // Expire after 15 min

  return parsed
}

export function buildGoogleContactsAuthUrl(stateData: any = {}, customRedirectUri?: string) {
  const config = getContactsOAuthConfig()
  const redirectUri = customRedirectUri || stateData.redirectUri || config.redirectUri

  const missing = getMissingContactsOAuthConfig()
  if (missing.length > 0 || !config.clientId || !redirectUri) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`)
  }

  const statePayload = {
    ...stateData,
    redirectUri
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', contactsScopes.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', createContactsOAuthState(statePayload))
  return url.toString()
}

export async function exchangeCodeForContactsTokens(code: string, customRedirectUri?: string) {
  const config = getContactsOAuthConfig()
  const redirectUri = customRedirectUri || config.redirectUri

  if (!config.clientId || !config.clientSecret || !redirectUri) {
    throw new Error('OAuth de Google Contacts no esta configurado.')
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'No se pudo autorizar Google Contacts.')
  }

  // Get user info to verify email
  let userEmail: string | null = null
  if (data.access_token) {
    try {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` }
      })
      if (userInfoRes.ok) {
        const userInfo = await userInfoRes.json()
        userEmail = userInfo.email || null
      }
    } catch (err) {
      console.warn('No se pudo obtener el email del usuario de Google:', err)
    }
  }

  return {
    ...data,
    userEmail
  }
}

export async function refreshContactsAccessToken(refreshToken: string): Promise<string> {
  const config = getContactsOAuthConfig()
  if (!config.clientId || !config.clientSecret) {
    throw new Error('OAuth de Google Contacts no esta configurado.')
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
    throw new Error(data.error_description || data.error || 'No se pudo refrescar el token de Google Contacts.')
  }

  return data.access_token
}

export async function saveContactsConnection(refreshToken: string, connectedEmail: string | null) {
  const adminDb = ensureAdminDb()
  if (!adminDb) {
    throw new Error('No se pudo acceder a la base de datos (Firebase Admin).')
  }

  if (!refreshToken) {
    throw new Error('No se recibio Refresh Token de Google.')
  }

  await adminDb.collection('googleContactsIntegrations').doc('central').set({
    id: 'central',
    provider: 'google_contacts',
    status: 'connected',
    connectedEmail: connectedEmail || TARGET_CENTRAL_EMAIL,
    refreshToken,
    scopes: contactsScopes,
    updatedAt: FieldValue.serverTimestamp(),
    connectedAt: FieldValue.serverTimestamp()
  }, { merge: true })
}

export async function getContactsConnection() {
  const adminDb = ensureAdminDb()
  if (!adminDb) return null

  const snap = await adminDb.collection('googleContactsIntegrations').doc('central').get()
  if (!snap.exists) return null

  return {
    id: snap.id,
    ...snap.data()
  } as any
}

export async function getValidAccessToken(): Promise<string> {
  const connection = await getContactsConnection()
  if (!connection || connection.status !== 'connected' || !connection.refreshToken) {
    throw new Error('Google Contacts no esta conectado.')
  }

  return await refreshContactsAccessToken(connection.refreshToken)
}

/**
 * Normaliza un número telefónico para Google Contacts.
 * Ejemplo para Ecuador: '0991234567' -> '+593991234567'
 */
export function normalizePhoneForGoogle(phone: string): string {
  if (!phone) return ''
  let cleaned = phone.replace(/[^\d+]/g, '')
  if (cleaned.startsWith('09') && cleaned.length === 10) {
    cleaned = '+593' + cleaned.substring(1)
  } else if (!cleaned.startsWith('+') && cleaned.length === 9 && cleaned.startsWith('9')) {
    cleaned = '+593' + cleaned
  }
  return cleaned || phone
}

/**
 * Crea un contacto en Google Contacts usando la Google People API.
 */
export async function createGoogleContact(contactData: { name: string; phone: string; email?: string; notes?: string }) {
  const accessToken = await getValidAccessToken()

  const formattedPhone = normalizePhoneForGoogle(contactData.phone)

  const payload: any = {
    names: [
      {
        givenName: contactData.name,
        displayName: contactData.name
      }
    ],
    phoneNumbers: formattedPhone ? [
      {
        value: formattedPhone,
        type: 'mobile'
      }
    ] : [],
    userDefined: [
      {
        key: 'Source',
        value: 'Fuddiverso'
      }
    ]
  }

  if (contactData.email) {
    payload.emails = [
      {
        value: contactData.email,
        type: 'home'
      }
    ]
  }

  if (contactData.notes) {
    payload.biographies = [
      {
        value: contactData.notes,
        contentType: 'TEXT_PLAIN'
      }
    ]
  }

  let response = await fetch('https://people.googleapis.com/v1/people:createContact', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  // Si Google responde con límite de tasa (429/403), hacer una pausa de 2.5s y reintentar
  if (response.status === 429 || response.status === 403) {
    await new Promise(resolve => setTimeout(resolve, 2500))
    response = await fetch('https://people.googleapis.com/v1/people:createContact', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
  }

  const data = await response.json()

  if (!response.ok) {
    console.error('❌ Error de Google People API:', data)
    throw new Error(data.error?.message || data.error_description || 'Error al crear contacto en Google Contacts')
  }

  return {
    success: true,
    resourceName: data.resourceName,
    etag: data.etag
  }
}
