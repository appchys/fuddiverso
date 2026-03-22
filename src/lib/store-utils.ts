import { Business, Delivery } from '@/types'

/**
 * Determina si la tienda está abierta considerando:
 * 1. Control manual (prioridad máxima)
 * 2. Horario configurado (si no hay control manual)
 * 
 * @param business - Objeto de negocio con horario y estado manual
 * @returns true si la tienda está abierta, false si está cerrada
 */
// Función para calcular cuándo debería expirar el control manual
export function calculateManualStatusExpiry(business: Business): Date | null {
  if (!business.schedule) {
    console.warn('⚠️ calculateManualStatusExpiry: No business schedule found')
    return null
  }

  const now = new Date()
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const currentDay = dayNames[now.getDay()]
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  // Buscar el horario de hoy de forma insensible a mayúsculas
  const scheduleKeys = Object.keys(business.schedule)
  const todayKey = scheduleKeys.find(k => k.toLowerCase() === currentDay)
  const todaySchedule = todayKey ? business.schedule[todayKey] : null

  console.log('🔍 Calculating manual expiry:', {
    currentDay,
    todayKey,
    hasTodaySchedule: !!todaySchedule,
    currentMinutes
  })

  if (!todaySchedule || !todaySchedule.isOpen) {
    // Si hoy está cerrado (o no hay horario), buscar próxima apertura en los próximos 7 días
    console.log('📅 Store closed today (or no schedule), looking for next open day...')
    for (let i = 1; i <= 7; i++) {
      const nextDayIndex = (now.getDay() + i) % 7
      const nextDayName = dayNames[nextDayIndex]
      const nextDayKey = scheduleKeys.find(k => k.toLowerCase() === nextDayName)
      const nextDaySchedule = nextDayKey ? business.schedule[nextDayKey] : null

      if (nextDaySchedule && nextDaySchedule.isOpen) {
        const expiryDate = new Date(now)
        expiryDate.setDate(now.getDate() + i)
        const [openH, openM] = normalizeTime(nextDaySchedule.open).split(':').map(Number)
        expiryDate.setHours(openH, openM, 0, 0)
        console.log(`✅ Next opening found: ${nextDayName} at ${nextDaySchedule.open}`, { expiryDate })
        return expiryDate
      }
    }
    console.warn('❌ No open day found in the next 7 days')
    return null
  }

  const [openH, openM] = normalizeTime(todaySchedule.open).split(':').map(Number)
  const [closeH, closeM] = normalizeTime(todaySchedule.close).split(':').map(Number)
  const openMinutes = openH * 60 + openM
  const closeMinutes = closeH * 60 + closeM

  let expiryDate = new Date(now)

  if (currentMinutes < openMinutes) {
    // Antes de hora de apertura: expirar a la hora de apertura
    expiryDate.setHours(openH, openM, 0, 0)
    console.log('⏰ Expiry set to today opening time:', expiryDate.toLocaleString('es-EC'))
  } else if (currentMinutes < closeMinutes) {
    // Durante horario abierto: expirar a la hora de cierre
    expiryDate.setHours(closeH, closeM, 0, 0)
    console.log('⏰ Expiry set to today closing time:', expiryDate.toLocaleString('es-EC'))
  } else {
    // Después de hora de cierre: expirar mañana (o el próximo día que se abra) a la hora de apertura
    console.log('🌙 After closing time today, looking for next opening...')
    for (let i = 1; i <= 7; i++) {
      const nextDayIndex = (now.getDay() + i) % 7
      const nextDayName = dayNames[nextDayIndex]
      const nextDayKey = scheduleKeys.find(k => k.toLowerCase() === nextDayName)
      const nextDaySchedule = nextDayKey ? business.schedule[nextDayKey] : null

      if (nextDaySchedule && nextDaySchedule.isOpen) {
        expiryDate.setDate(now.getDate() + i)
        const [nextOpenH, nextOpenM] = normalizeTime(nextDaySchedule.open).split(':').map(Number)
        expiryDate.setHours(nextOpenH, nextOpenM, 0, 0)
        console.log(`✅ Next opening found: ${nextDayName} at ${nextDaySchedule.open}`, { expiryDate })
        return expiryDate
      }
    }
    console.warn('❌ No future open day found')
    return null
  }

  return expiryDate
}

export function isStoreOpen(business: Business | null): boolean {
    if (!business) return false

    const now = new Date()

    // 1. Verificar si el control manual ha expirado
    if (business.manualStoreStatus) {
        if (business.manualStatusExpiry) {
            // Asegurar que manejamos Timestamp de Firestore o Date
            const expiryTime = business.manualStatusExpiry instanceof Date 
                ? business.manualStatusExpiry 
                : (business.manualStatusExpiry as any).seconds 
                    ? new Date((business.manualStatusExpiry as any).seconds * 1000)
                    : new Date(business.manualStatusExpiry)
            
            if (now >= expiryTime) {
                console.log('⏰ Manual status expired:', {
                    now: now.toLocaleString('es-EC'),
                    expiry: expiryTime.toLocaleString('es-EC')
                })
                // El control manual ha expirado, continuar con lógica automática
            } else {
                // El control manual todavía está activo
                if (business.manualStoreStatus === 'open') {
                    console.log('🟢 Store OPEN (manual override Active)')
                    return true
                }
                if (business.manualStoreStatus === 'closed') {
                    console.log('🔴 Store CLOSED (manual override Active)')
                    return false
                }
            }
        } else {
            // Caso antiguo o sin fecha: control manual sin expiración
            if (business.manualStoreStatus === 'open') {
                console.log('🟢 Store OPEN (manual override - no expiry)')
                return true
            }
            if (business.manualStoreStatus === 'closed') {
                console.log('🔴 Store CLOSED (manual override - no expiry)')
                return false
            }
        }
    }

    // 2. Verificar horario automático
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const currentDay = dayNames[now.getDay()]
    
    const todaySchedule = business.schedule?.[currentDay]

    // Si no hay horario definido para hoy o está marcado como cerrado
    if (!todaySchedule || !todaySchedule.isOpen) {
        return false
    }

    // Comparar hora actual con horario de apertura/cierre
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    
    // Normalizar horas para evitar errores de formato (ej: "9:00" -> "09:00")
    const [openH, openM] = normalizeTime(todaySchedule.open).split(':').map(Number)
    const [closeH, closeM] = normalizeTime(todaySchedule.close).split(':').map(Number)
    
    const openMinutes = openH * 60 + openM
    const closeMinutes = closeH * 60 + closeM
    
    return currentMinutes >= openMinutes && currentMinutes <= closeMinutes
}

/**
 * Obtiene una descripción del estado actual de la tienda
 * @param business - Objeto de negocio
 * @returns Descripción del estado (ej: "Abierto (Manual)", "Cerrado (Horario)")
 */
export function getStoreStatusDescription(business: Business | null): string {
    if (!business) return 'Desconocido'

    const now = new Date()
    const isOpen = isStoreOpen(business)

    // Si hay estado manual, verificar si está activo o caducado
    if (business.manualStoreStatus) {
        let isExpired = false
        if (business.manualStatusExpiry) {
            const expiryTime = business.manualStatusExpiry instanceof Date 
                ? business.manualStatusExpiry 
                : (business.manualStatusExpiry as any).seconds 
                    ? new Date((business.manualStatusExpiry as any).seconds * 1000)
                    : new Date(business.manualStatusExpiry)
            
            if (now >= expiryTime) {
                isExpired = true
            }
        }

        if (!isExpired) {
            return business.manualStoreStatus === 'open' ? 'Abierto (Manual)' : 'Cerrado (Manual)'
        }
        // Si caducó, mostramos el estado de horario pero con una nota? 
        // Por ahora solo el estado de horario para que sea consistente
    }

    return isOpen ? 'Abierto (Horario)' : 'Cerrado (Horario)'
}

/**
 * Normaliza una hora en formato H:M o HH:M a HH:MM para comparación segura.
 * Maneja espacios y segundos si existieran.
 */
export function normalizeTime(time: string): string {
    if (!time || typeof time !== 'string') return '00:00'
    // Limpiar espacios y segundos
    const cleanTime = time.trim().split(' ')[0]
    const parts = cleanTime.split(':')
    if (parts.length < 2) return cleanTime.padStart(5, '0').includes(':') ? cleanTime : `${cleanTime.padStart(2, '0')}:00`

    // Tomar solo HH y MM ignorando SS si existiera
    let [h, m] = parts
    h = (h || '0').padStart(2, '0')
    m = (m || '0').padStart(2, '0')
    return `${h}:${m}`
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

/**
 * Obtiene un mensaje descriptivo de cuándo abrirá la tienda.
 * Ej: "Abre el lunes a las 13:30" o "Abre en 50 minutos"
 */
export function getNextOpeningMessage(business: Business | null): string | null {
    if (!business) return null
    if (isStoreOpen(business)) return null

    const now = new Date()
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const dayTranslations: Record<string, string> = {
        'sunday': 'domingo',
        'monday': 'lunes',
        'tuesday': 'martes',
        'wednesday': 'miércoles',
        'thursday': 'jueves',
        'friday': 'viernes',
        'saturday': 'sábado'
    }

    // Buscar en los próximos 7 días
    for (let i = 0; i < 7; i++) {
        const date = new Date(now)
        date.setDate(date.getDate() + i)
        const dayName = days[date.getDay()]
        const schedule = business.schedule?.[dayName]

        if (schedule && schedule.isOpen) {
            const [openH, openM] = normalizeTime(schedule.open).split(':').map(Number)
            const openTime = new Date(date)
            openTime.setHours(openH, openM, 0, 0)

            // Si es hoy Y ya pasó la hora de cierre, ignoramos (salvo que sea manual close, que igual ignoramos hoy)
            // Si es hoy Y es antes de abrir, openTime > now.
            // Si es hoy Y estamos en medio (pero cerrado manual), openTime < now.

            if (openTime > now) {
                const diffMs = openTime.getTime() - now.getTime()
                const diffMins = Math.floor(diffMs / 60000)

                if (diffMins < 60) {
                    return `Abre en ${diffMins} minutos`
                } else {
                    return `Abre el ${dayTranslations[dayName]} a las ${schedule.open}`
                }
            }
        }
    }
    return null
}

// ─── Delivery Availability Utilities ─────────────────────────────────────────

/**
 * Determina si un repartidor está disponible considerando:
 * 1. Control manual (prioridad máxima)
 * 2. Si tiene horarios configurados y activados, verifica si el momento
 *    actual está dentro de alguno de esos bloques.
 * 3. Si no hay horario configurado/activado y está en estado 'activo', disponible.
 *
 * @param delivery - Objeto repartidor
 * @returns true si el delivery está disponible ahora
 */
export function isDeliveryAvailable(delivery: Delivery | null): boolean {
    if (!delivery) return false

    // Si está marcado como inactivo (global), nunca disponible
    if (delivery.estado === 'inactivo') return false

    // 1. Override manual tiene prioridad sobre horario
    if (delivery.manualStatus === 'active') return true
    if (delivery.manualStatus === 'inactive') return false

    // 2. Verificar horario automático si está habilitado
    const sched = delivery.scheduleAvailability
    if (sched?.enabled && sched.schedules.length > 0) {
        const now = new Date()
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        const currentDay = dayNames[now.getDay()]
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

        // Está disponible si hay al menos un bloque de horario que cubra ahora
        return sched.schedules.some(block =>
            block.days.includes(currentDay) &&
            currentTime >= block.startTime &&
            currentTime <= block.endTime
        )
    }

    // 3. Sin horario configurado: disponible si estado es 'activo'
    return delivery.estado === 'activo'
}

/**
 * Obtiene una descripción del estado actual del repartidor.
 * Ej: "Disponible (Manual)", "No disponible (Horario)", "Disponible (Auto)"
 */
export function getDeliveryStatusDescription(delivery: Delivery | null): string {
    if (!delivery) return 'Desconocido'

    if (delivery.estado === 'inactivo') return 'Inactivo'

    if (delivery.manualStatus === 'active') return 'Disponible (Manual)'
    if (delivery.manualStatus === 'inactive') return 'No disponible (Manual)'

    const available = isDeliveryAvailable(delivery)
    const hasSchedule = delivery.scheduleAvailability?.enabled && (delivery.scheduleAvailability.schedules.length ?? 0) > 0
    if (hasSchedule) {
        return available ? 'Disponible (Horario)' : 'No disponible (Horario)'
    }
    return 'Disponible (Auto)'
}
