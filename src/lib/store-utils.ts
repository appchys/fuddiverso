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

/**
 * Calcula el próximo slot disponible para programar un pedido.
 * Busca en los próximos 7 días el primer horario de apertura válido.
 */
export function getNextAvailableSlot(business: Business | null): { date: string, time: string } | null {
    if (!business) return null

    const now = new Date()
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

    // Si está cerrado manualmente, empezamos a buscar desde mañana
    let startDayOffset = 0
    if (business.manualStoreStatus === 'closed') {
        startDayOffset = 1
    }

    // Buscar en los próximos 7 días
    for (let i = startDayOffset; i < 7; i++) {
        const d = new Date(now)
        d.setDate(d.getDate() + i)
        const dayName = dayNames[d.getDay()]
        const schedule = business.schedule?.[dayName]

        if (schedule && schedule.isOpen) {
            const year = d.getFullYear()
            const month = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            const dateStr = `${year}-${month}-${day}`

            // Si es hoy, verificar horas
            if (i === 0) {
                const currentMinutes = now.getHours() * 60 + now.getMinutes()

                const [closeH, closeM] = normalizeTime(schedule.close).split(':').map(Number)
                const closeMinutes = closeH * 60 + closeM

                const [openH, openM] = normalizeTime(schedule.open).split(':').map(Number)
                const openMinutes = openH * 60 + openM

                // Margen de 30 min mínimo para pedidos programados
                const bufferMinutes = 30
                const potentialStartMinutes = currentMinutes + bufferMinutes

                // Si es antes de abrir, el slot es la hora de apertura
                if (potentialStartMinutes < openMinutes) {
                    return { date: dateStr, time: schedule.open }
                }

                // Si estamos dentro del tiempo operativo (y hay tiempo antes del cierre)
                if (potentialStartMinutes < closeMinutes) {
                    const h = Math.floor(potentialStartMinutes / 60)
                    const m = potentialStartMinutes % 60
                    const nextTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
                    return { date: dateStr, time: nextTime }
                }

                // Si ya no hay tiempo hoy, el loop continuará a mañana
            } else {
                // Para días futuros, devolvemos la hora de apertura
                return { date: dateStr, time: schedule.open }
            }
        }
    }
    return null
}
