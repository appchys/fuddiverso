import { initializeApp, cert, getApps, App } from 'firebase-admin/app'
import { getFirestore, Firestore } from 'firebase-admin/firestore'
import * as fs from 'fs'
import * as path from 'path'

let adminDb: Firestore | null = null

export function ensureAdminDb(): Firestore | null {
  if (adminDb) return adminDb

  let serviceAccount: any = null

  // 1. Intentar desde variable de entorno
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const keyString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      serviceAccount = JSON.parse(keyString)
      
      // Si la llave privada tiene los saltos de línea escapados como texto literal "\n", corregirlos
      if (serviceAccount.private_key && typeof serviceAccount.private_key === 'string' && serviceAccount.private_key.includes('\\n')) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n')
      }
    } catch (error) {
      console.warn('[Firebase Admin] Error al parsear FIREBASE_SERVICE_ACCOUNT_KEY:', error)
    }
  }

  // 2. Intentar desde archivo local (fallback para desarrollo)
  if (!serviceAccount) {
    try {
      const credentialsPath = path.join(
        process.cwd(),
        'multitienda-69778-firebase-adminsdk-fbsvc-496524456f.json'
      )
      if (fs.existsSync(credentialsPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'))
      }
    } catch (error) {
      console.warn('[Firebase Admin] No se pudieron leer las credenciales del archivo:', error)
    }
  }

  // 3. Inicializar o recuperar App
  try {
    const apps = getApps()
    let app: App
    
    if (apps.length > 0) {
      app = apps[0]
    } else if (serviceAccount && serviceAccount.private_key) {
      app = initializeApp({
        credential: cert(serviceAccount)
      })
    } else {
      console.error('[Firebase Admin] No hay serviceAccount ni apps inicializadas')
      return null
    }
    
    adminDb = getFirestore(app)
    return adminDb
  } catch (error) {
    console.error('[Firebase Admin] Error crítico de inicialización:', error)
    return null
  }
}
