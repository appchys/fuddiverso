// authSessionGuard.ts
// Protege la sesión de Firebase Auth frente a cierres "falsos" causados por
// conexiones lentas/inestables.
//
// Contexto: al recargar la página (p.ej. el navegador móvil descarta la pestaña
// al abrir WhatsApp), Firebase Auth valida el usuario guardado contra la red.
// Si esa validación falla con cualquier error distinto a
// `auth/network-request-failed`, el SDK borra la sesión persistida y el usuario
// tiene que volver a iniciar sesión con Google.
//
// Estrategia: guardamos una copia de la sesión (mismo formato que Firebase
// persiste) y, si Firebase la descarta sin que el usuario haya cerrado sesión
// explícitamente, la reinyectamos una sola vez y recargamos. Si el token
// realmente fue revocado, el segundo intento también fallará y dejamos de
// reintentar (cooldown), enviando al usuario al login como siempre.

import type { Auth, User } from 'firebase/auth'

const BACKUP_KEY = 'fuddi:authSessionBackup'
const RESTORE_ATTEMPT_KEY = 'fuddi:authRestoreAttemptAt'
const RESTORE_COOLDOWN_MS = 2 * 60 * 1000 // 2 minutos

interface AuthSessionBackup {
  uid: string
  savedAt: number
  user: Record<string, unknown>
}

const isBrowser = (): boolean => typeof window !== 'undefined' && typeof localStorage !== 'undefined'

/** Clave que usa `browserLocalPersistence` para guardar el usuario actual. */
function getFirebasePersistenceKey(auth: Auth): string {
  return `firebase:authUser:${auth.app.options.apiKey}:${auth.app.name}`
}

/** Guarda una copia de la sesión actual. Llamar cada vez que haya usuario/token nuevo. */
export function backupAuthSession(user: User): void {
  if (!isBrowser()) return
  try {
    const json = (user as unknown as { toJSON: () => Record<string, unknown> }).toJSON()
    const backup: AuthSessionBackup = { uid: user.uid, savedAt: Date.now(), user: json }
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backup))
  } catch {
    // No crítico
  }
}

/** Marca la sesión como sana (se llamó a onAuthStateChanged con usuario válido). */
export function markAuthSessionHealthy(): void {
  if (!isBrowser()) return
  try {
    localStorage.removeItem(RESTORE_ATTEMPT_KEY)
  } catch {
    // No crítico
  }
}

/** Elimina la copia de seguridad. Debe llamarse en cualquier cierre de sesión explícito. */
export function clearAuthSessionBackup(): void {
  if (!isBrowser()) return
  try {
    localStorage.removeItem(BACKUP_KEY)
    localStorage.removeItem(RESTORE_ATTEMPT_KEY)
  } catch {
    // No crítico
  }
}

/**
 * Intenta restaurar una sesión que Firebase descartó por un fallo transitorio.
 * @returns `true` si se inició la restauración (la página se recargará).
 */
export function tryRestoreAuthSession(auth: Auth): boolean {
  if (!isBrowser()) return false
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) return false

    const lastAttempt = Number(localStorage.getItem(RESTORE_ATTEMPT_KEY) || 0)
    if (lastAttempt && Date.now() - lastAttempt < RESTORE_COOLDOWN_MS) {
      // Ya lo intentamos hace poco y volvió a fallar: el token probablemente
      // fue revocado de verdad. Nos rendimos y dejamos que vaya al login.
      console.warn('[AuthGuard] La restauración de sesión falló nuevamente; se requiere iniciar sesión.')
      clearAuthSessionBackup()
      return false
    }

    const backup = JSON.parse(raw) as AuthSessionBackup
    const stsTokenManager = backup?.user?.stsTokenManager as { refreshToken?: string } | undefined
    if (!backup?.uid || !stsTokenManager?.refreshToken) {
      clearAuthSessionBackup()
      return false
    }

    localStorage.setItem(getFirebasePersistenceKey(auth), JSON.stringify(backup.user))
    localStorage.setItem(RESTORE_ATTEMPT_KEY, String(Date.now()))
    console.log('[AuthGuard] Sesión descartada por fallo transitorio; restaurando...')
    window.location.reload()
    return true
  } catch (err) {
    console.error('[AuthGuard] Error restaurando sesión:', err)
    return false
  }
}
