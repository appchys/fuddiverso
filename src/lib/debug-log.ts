import { db } from '@/lib/firebase'
import { collection, addDoc, serverTimestamp, query, orderBy, limit as firestoreLimit, getDocs, where, Timestamp } from 'firebase/firestore'

export type LogLevel = 'info' | 'warn' | 'error'
export type LogCategory = 'manual_order' | 'checkout' | 'order_creation' | 'timing_debug' | 'system'

export interface DebugLogEntry {
  id?: string
  timestamp?: any
  localTimestamp: string
  timezoneOffset: number
  timezoneName?: string
  level: LogLevel
  category: LogCategory
  action: string
  businessId?: string
  businessName?: string
  userId?: string
  orderId?: string
  data?: Record<string, any>
}

/**
 * Registra un log persistente en la colección 'debug_logs' de Firestore.
 * Es completamente asíncrono y seguro (no bloquea ni rompe la ejecución si falla).
 */
export async function logDebug(
  category: LogCategory,
  action: string,
  data?: Record<string, any>,
  options?: {
    level?: LogLevel
    businessId?: string
    businessName?: string
    userId?: string
    orderId?: string
  }
): Promise<string | null> {
  try {
    const now = new Date()
    const entry: DebugLogEntry = {
      localTimestamp: now.toLocaleString('es-EC', { hour12: false }),
      timezoneOffset: now.getTimezoneOffset(),
      timezoneName: Intl.DateTimeFormat().resolvedOptions().timeZone,
      level: options?.level || 'info',
      category,
      action,
      businessId: options?.businessId || (data?.businessId as string) || undefined,
      businessName: options?.businessName || (data?.businessName as string) || undefined,
      userId: options?.userId || undefined,
      orderId: options?.orderId || (data?.orderId as string) || undefined,
      data: sanitizeDataForFirestore(data || {}),
      timestamp: serverTimestamp()
    }

    // Log en consola local también
    const prefix = `[DEBUG_LOG:${category.toUpperCase()}]`
    if (entry.level === 'error') {
      console.error(prefix, action, entry)
    } else if (entry.level === 'warn') {
      console.warn(prefix, action, entry)
    } else {
      console.log(prefix, action, entry)
    }

    const docRef = await addDoc(collection(db, 'debug_logs'), entry)
    return docRef.id
  } catch (err) {
    console.warn('⚠️ No se pudo guardar el log de depuración en Firestore:', err)
    return null
  }
}

/**
 * Obtiene los logs más recientes de la colección 'debug_logs'.
 */
export async function getRecentDebugLogs(options?: {
  businessId?: string
  category?: LogCategory
  limitCount?: number
}): Promise<DebugLogEntry[]> {
  try {
    const logsRef = collection(db, 'debug_logs')
    const limitNum = options?.limitCount || 100

    let q = query(logsRef, orderBy('timestamp', 'desc'), firestoreLimit(limitNum))

    if (options?.businessId) {
      q = query(logsRef, where('businessId', '==', options.businessId), orderBy('timestamp', 'desc'), firestoreLimit(limitNum))
    }

    const snapshot = await getDocs(q)
    return snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    } as DebugLogEntry))
  } catch (err) {
    console.error('Error al obtener logs de depuración:', err)
    return []
  }
}

/**
 * Limpia y sanitiza objetos para evitar errores de tipos no soportados o undefined en Firestore.
 */
function sanitizeDataForFirestore(obj: any): any {
  if (obj === null || obj === undefined) return null
  if (obj instanceof Date) return Timestamp.fromDate(obj)
  if (obj instanceof Timestamp) return obj
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sanitizeDataForFirestore)

  const cleaned: Record<string, any> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      cleaned[key] = sanitizeDataForFirestore(val)
    }
  }
  return cleaned
}
