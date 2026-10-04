// connectivity.ts
// Estado de conexión "real" de la app y seguimiento de escrituras pendientes.
//
// - `navigator.onLine` solo indica si hay una interfaz de red; con datos móviles
//   lentos puede decir "online" sin que pase ningún dato. Por eso hacemos una
//   comprobación real (HEAD sin caché) cuando hay sospechas.
// - Las peticiones HEAD no pasan por las rutas del Service Worker (Workbox solo
//   registra GET), así que la respuesta siempre viene de la red.
// - Las escrituras de Firestore pendientes se cuentan con un contador propio
//   (escrituras hechas vía `commitWrite`) + `waitForPendingWrites` para las que
//   quedaron de sesiones anteriores (persistidas en IndexedDB).

import { waitForPendingWrites } from 'firebase/firestore'
import { db } from './firebase'

export interface ConnectivityState {
  /** Hay conexión efectiva (no solo interfaz de red) */
  online: boolean
  /** Escrituras de Firestore aún no confirmadas por el servidor */
  pendingWrites: number
  /** Tareas secundarias en la cola persistente */
  pendingTasks: number
  /** Hay algo subiéndose en este momento */
  syncing: boolean
  /** Última vez que todo quedó sincronizado */
  lastSyncedAt: number | null
}

type Listener = (state: ConnectivityState) => void

const PROBE_URL = '/manifest.json'
const PROBE_TIMEOUT_MS = 6000
const PROBE_INTERVAL_MS = 20000

const isBrowser = typeof window !== 'undefined'

let state: ConnectivityState = {
  online: isBrowser ? navigator.onLine : true,
  pendingWrites: 0,
  pendingTasks: 0,
  syncing: false,
  lastSyncedAt: null
}

const listeners = new Set<Listener>()
let trackedWrites = 0
let firestoreBacklog = false
let initialized = false
let probeInFlight: Promise<boolean> | null = null
let probeTimer: ReturnType<typeof setInterval> | null = null
let waitingBacklog = false

function emit(partial: Partial<ConnectivityState>) {
  const prevSyncing = state.pendingWrites > 0 || state.pendingTasks > 0 || firestoreBacklog
  state = { ...state, ...partial }
  const nowSyncing = state.pendingWrites > 0 || state.pendingTasks > 0 || firestoreBacklog
  state.syncing = nowSyncing && state.online
  if (prevSyncing && !nowSyncing) {
    state.lastSyncedAt = Date.now()
  }
  listeners.forEach(l => l(state))
}

/** Comprobación real de conectividad. */
export function probeConnectivity(): Promise<boolean> {
  if (!isBrowser) return Promise.resolve(true)
  if (!navigator.onLine) {
    if (state.online) emit({ online: false })
    return Promise.resolve(false)
  }
  if (probeInFlight) return probeInFlight

  probeInFlight = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      await fetch(`${PROBE_URL}?_=${Date.now()}`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal
      })
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  })()

  return probeInFlight.then(ok => {
    probeInFlight = null
    if (ok !== state.online) {
      emit({ online: ok })
      if (ok) trackFirestoreBacklog()
    }
    return ok
  })
}

/** Espera a que Firestore suba lo pendiente (incluye escrituras de sesiones anteriores). */
function trackFirestoreBacklog() {
  if (!isBrowser || waitingBacklog) return
  waitingBacklog = true
  // Solo marcar "sincronizando" si tarda más de 400 ms (evita parpadeos)
  const flagTimer = setTimeout(() => {
    firestoreBacklog = true
    emit({})
  }, 400)
  waitForPendingWrites(db)
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(flagTimer)
      waitingBacklog = false
      if (firestoreBacklog) {
        firestoreBacklog = false
        emit({})
      }
    })
}

/** Inicializa listeners globales (idempotente). */
export function initConnectivity() {
  if (!isBrowser || initialized) return
  initialized = true

  window.addEventListener('online', () => {
    emit({ online: true })
    probeConnectivity()
    trackFirestoreBacklog()
  })
  window.addEventListener('offline', () => emit({ online: false }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') probeConnectivity()
  })

  probeTimer = setInterval(() => {
    if (document.visibilityState === 'visible') probeConnectivity()
  }, PROBE_INTERVAL_MS)

  trackFirestoreBacklog()
  probeConnectivity()
}

export function getConnectivityState(): ConnectivityState {
  return state
}

export function isEffectivelyOnline(): boolean {
  return isBrowser ? navigator.onLine && state.online : true
}

export function subscribeConnectivity(listener: Listener): () => void {
  initConnectivity()
  listeners.add(listener)
  listener(state)
  return () => {
    listeners.delete(listener)
  }
}

/** Registra una escritura en curso; devuelve la función para marcarla como terminada. */
export function trackWrite(): () => void {
  trackedWrites++
  emit({ pendingWrites: trackedWrites })
  let done = false
  return () => {
    if (done) return
    done = true
    trackedWrites = Math.max(0, trackedWrites - 1)
    emit({ pendingWrites: trackedWrites })
  }
}

/** La cola de tareas informa cuántas tareas tiene pendientes. */
export function setPendingTasks(count: number) {
  if (count !== state.pendingTasks) emit({ pendingTasks: count })
}

/** Para pruebas / limpieza */
export function destroyConnectivity() {
  if (probeTimer) clearInterval(probeTimer)
  probeTimer = null
  listeners.clear()
  initialized = false
}
