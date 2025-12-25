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
