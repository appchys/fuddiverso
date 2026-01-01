import { Business } from '@/types'

/**
 * Determina si la tienda está abierta considerando:
 * 1. Control manual (prioridad máxima)
 * 2. Horario configurado (si no hay control manual)
 * 
 * @param business - Objeto de negocio con horario y estado manual
 * @returns true si la tienda está abierta, false si está cerrada
 */
export function isStoreOpen(business: Business | null): boolean {
    if (!business) return false

    // 1. Si hay control manual, tiene prioridad sobre el horario
    if (business.manualStoreStatus === 'open') return true
    if (business.manualStoreStatus === 'closed') return false

    // 2. Verificar horario automático
    const now = new Date()
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const currentDay = dayNames[now.getDay()]

    const todaySchedule = business.schedule?.[currentDay]

    // Si no hay horario definido para hoy o está marcado como cerrado
    if (!todaySchedule || !todaySchedule.isOpen) return false

    // Comparar hora actual con horario de apertura/cierre
    const currentTime = now.toTimeString().slice(0, 5) // HH:MM formato
    return currentTime >= todaySchedule.open && currentTime <= todaySchedule.close
}

/**
 * Obtiene una descripción del estado actual de la tienda
 * @param business - Objeto de negocio
 * @returns Descripción del estado (ej: "Abierto (Manual)", "Cerrado (Horario)")
 */
export function getStoreStatusDescription(business: Business | null): string {
    if (!business) return 'Desconocido'

    const isOpen = isStoreOpen(business)

    if (business.manualStoreStatus === 'open') {
        return 'Abierto (Manual)'
    } else if (business.manualStoreStatus === 'closed') {
        return 'Cerrado (Manual)'
    } else {
        return isOpen ? 'Abierto (Horario)' : 'Cerrado (Horario)'
    }
}

/**
 * Normaliza una hora en formato H:M o HH:M a HH:MM para comparación segura.
 * Maneja espacios y segundos si existieran.
 */
export function normalizeTime(time: string): string {
    if (!time) return ''
    // Limpiar espacios y segundos
    const cleanTime = time.trim().split(' ')[0]
    const parts = cleanTime.split(':')
    if (parts.length < 2) return cleanTime

    // Tomar solo HH y MM ignorando SS si existiera
    const [h, m] = parts
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

/**
 * Valida si una fecha y hora específicas están dentro del horario de la tienda.
 */
export function isSpecificTimeOpen(business: Business | null, dateStr: string, timeStr: string): boolean {
    if (!business || !dateStr || !timeStr) return false

    const [year, month, day] = dateStr.split('-').map(Number)
    const requestedDate = new Date(year, month - 1, day)
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const dayOfWeek = dayNames[requestedDate.getDay()]

    const schedule = business.schedule?.[dayOfWeek]

    if (!schedule || !schedule.isOpen) return false

    // Normalizar para comparación de texto segura (ej: "9:00" -> "09:00")
    const normalizedRequested = normalizeTime(timeStr)
    const normalizedOpen = normalizeTime(schedule.open)
    const normalizedClose = normalizeTime(schedule.close)

    return normalizedRequested >= normalizedOpen && normalizedRequested <= normalizedClose
}

/**
 * Obtiene el horario de la tienda para un día específico.
 */
export function getStoreScheduleForDate(business: Business | null, dateStr: string) {
    if (!business || !dateStr) return null
    const [year, month, day] = dateStr.split('-').map(Number)
    const requestedDate = new Date(year, month - 1, day)
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const dayOfWeek = dayNames[requestedDate.getDay()]

    // Traducción de días para el mensaje
    const dayTranslations: Record<string, string> = {
        'sunday': 'domingo',
        'monday': 'lunes',
        'tuesday': 'martes',
        'wednesday': 'miércoles',
        'thursday': 'jueves',
        'friday': 'viernes',
        'saturday': 'sábado'
    }

    return {
        schedule: business.schedule?.[dayOfWeek] || null,
        dayName: dayTranslations[dayOfWeek] || dayOfWeek
    }
}
