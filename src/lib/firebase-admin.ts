import { initializeApp, cert, getApps, App } from 'firebase-admin/app'
import { getAuth, Auth } from 'firebase-admin/auth'
import { getFirestore, Firestore } from 'firebase-admin/firestore'
import * as fs from 'fs'
import * as path from 'path'

let adminDb: Firestore | null = null
let adminAuth: Auth | null = null

function ensureAdminApp(): App | null {
  let serviceAccount: any = null

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)

      if (serviceAccount.private_key && typeof serviceAccount.private_key === 'string' && serviceAccount.private_key.includes('\\n')) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n')
      }
    } catch (error) {
      console.warn('[Firebase Admin] Error al parsear FIREBASE_SERVICE_ACCOUNT_KEY:', error)
    }
  }

  if (!serviceAccount) {
    try {
      const credentialFiles = [
        'multitienda-69778-firebase-adminsdk-fbsvc-496524456f.json',
        'sa_key.json'
      ]

      for (const fileName of credentialFiles) {
        const credentialsPath = path.join(process.cwd(), fileName)
        if (fs.existsSync(credentialsPath)) {
          serviceAccount = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'))
          break
        }
      }
    } catch (error) {
      console.warn('[Firebase Admin] No se pudieron leer las credenciales del archivo:', error)
    }
  }

  try {
    const apps = getApps()

    if (apps.length > 0) {
      return apps[0]
    }

    if (serviceAccount && serviceAccount.private_key) {
      return initializeApp({
        credential: cert(serviceAccount)
      })
    }

    console.error('[Firebase Admin] No hay serviceAccount ni apps inicializadas')
    return null
  } catch (error) {
    console.error('[Firebase Admin] Error critico de inicializacion:', error)
    return null
  }
}

export function ensureAdminDb(): Firestore | null {
  if (adminDb) return adminDb

  const app = ensureAdminApp()
  if (!app) return null

  adminDb = getFirestore(app)
  return adminDb
}

export function ensureAdminAuth(): Auth | null {
  if (adminAuth) return adminAuth

  const app = ensureAdminApp()
  if (!app) return null

  adminAuth = getAuth(app)
  return adminAuth
}
