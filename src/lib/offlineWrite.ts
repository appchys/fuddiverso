// offlineWrite.ts
// Utilidades para que las escrituras/lecturas de Firestore no bloqueen la UI
// cuando no hay conexión o la conexión es muy lenta.
//
// Firestore (con persistentLocalCache) aplica cada escritura en la caché local
// de inmediato y la guarda en una cola persistente (IndexedDB) que se sube sola
// al volver la conexión. Lo único que "espera al servidor" es la promesa que
// devuelven setDoc/updateDoc/deleteDoc. Aquí dejamos de bloquear en esa promesa
// cuando no tiene sentido esperarla.

import {
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot
} from 'firebase/firestore'
import { isEffectivelyOnline, probeConnectivity, trackWrite } from './connectivity'

export interface CommitResult {
  /** true = el servidor aún no confirmó; quedó en la cola local de Firestore */
  queued: boolean
}

export interface CommitOptions {
  /** Etiqueta para logs */
  label?: string
  /** Tiempo máximo a esperar la confirmación del servidor estando online */
  timeoutMs?: number
}

const DEFAULT_COMMIT_TIMEOUT_MS = 4000

/**
 * Ejecuta una escritura de Firestore sin bloquear indefinidamente.
 *
 * - Online: espera la confirmación hasta `timeoutMs`; si tarda más, la deja en
 *   cola y devuelve `{ queued: true }`.
 * - Offline: devuelve `{ queued: true }` inmediatamente.
 * - Errores reales del servidor (permisos, validación) recibidos dentro del
 *   tiempo límite se relanzan; los que lleguen después solo se registran.
 *
 * IMPORTANTE: la escritura (`write`) debe iniciarse dentro de esta función o
 * justo antes, para que Firestore la aplique en la caché local de inmediato.
 */
export async function commitWrite(
  write: Promise<unknown>,
  { label = 'write', timeoutMs = DEFAULT_COMMIT_TIMEOUT_MS }: CommitOptions = {}
): Promise<CommitResult> {
  // En servidor (API routes) no hay caché offline: esperar la escritura completa
  if (typeof window === 'undefined') {
    await write
    return { queued: false }
  }

  const done = trackWrite()
  let settled = false

  const tracked = write.then(
    () => {
      settled = true
      done()
    },
    (error) => {
      settled = true
      done()
      throw error
    }
  )

  if (!isEffectivelyOnline()) {
    tracked.catch(err => console.error(`[offlineWrite] ${label} falló al sincronizar:`, err))
    return { queued: true }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  const okPromise = tracked.then(() => 'ok' as const)

  try {
    const result = await Promise.race([okPromise, timeout])
    if (result === 'timeout' && !settled) {
      console.warn(`[offlineWrite] ${label}: sin confirmación en ${timeoutMs}ms, queda en cola`)
      okPromise.catch(err => console.error(`[offlineWrite] ${label} falló al sincronizar:`, err))
      probeConnectivity()
      return { queued: true }
    }
    return { queued: false }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Lee un documento sin quedarse colgado sin conexión (usa la caché local). */
export async function getDocSmart<T = DocumentData>(
  ref: DocumentReference<T>
): Promise<DocumentSnapshot<T>> {
  if (!isEffectivelyOnline()) {
    try {
      return await getDocFromCache(ref)
    } catch {
      // No está en caché: intentar getDoc normal (Firestore devolverá error offline)
    }
  }
  return getDoc(ref)
}

/** Ejecuta una consulta sin quedarse colgado sin conexión (usa la caché local). */
export async function getDocsSmart<T = DocumentData>(
  q: Query<T>
): Promise<QuerySnapshot<T>> {
  if (!isEffectivelyOnline()) {
    return getDocsFromCache(q)
  }
  return getDocs(q)
}
