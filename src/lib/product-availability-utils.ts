import { Product, ProductSchedule, Business } from '../types'
import { isSpecificTimeOpen, getNextAvailableSlot } from './store-utils'

/**
 * Obtiene el día de la semana en formato "Monday", "Tuesday", etc.
 * @param date - Fecha a revisar (por defecto la actual)
 */
export function getDayOfWeek(date: Date = new Date()): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return days[date.getDay()]
}

/**
 * Obtiene el día de la semana en formato abreviado "Sun", "Mon", etc.
 */
export function getDayOfWeekShort(date: Date = new Date()): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return days[date.getDay()]
}

/**
 * Convierte una hora en formato HH:mm a minutos desde medianoche
 */
function timeToMinutes(timeString: string): number {
  const [hours, minutes] = timeString.split(':').map(Number)
  return hours * 60 + (minutes || 0)
}

/**
 * Verifica si una hora está dentro de un rango de horarios
 * @param currentTime - Hora actual en formato HH:mm
 * @param startTime - Hora de inicio del rango
 * @param endTime - Hora de fin del rango
 */
function isTimeInRange(currentTime: string, startTime: string, endTime: string): boolean {
  const current = timeToMinutes(currentTime)
  const start = timeToMinutes(startTime)
  const end = timeToMinutes(endTime)

  let result = false
  if (start > end) {
    result = current >= start || current <= end
  } else {
    result = current >= start && current <= end
  }

  console.log(`⏰ [TimeMatch] ${currentTime} in [${startTime} - ${endTime}] -> ${result} (curr:${current}, start:${start}, end:${end})`)
  return result
}

/**
 * Verifica si un día está incluido en la lista de días del horario
 * Soporta ambos formatos: "Monday" y "Mon"
 */
function isDayMatching(currentDay: string, scheduleDays: string[]): boolean {
  const dayMap: Record<string, string> = {
    Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday',
    Sunday: 'Sunday', Monday: 'Monday', Tuesday: 'Tuesday', Wednesday: 'Wednesday', Thursday: 'Thursday', Friday: 'Friday', Saturday: 'Saturday'
  }

  const normalizedCurrentDay = dayMap[currentDay] || currentDay

  const match = scheduleDays.some(day => {
    const normalizedDay = dayMap[day] || day
    return normalizedDay.toLowerCase() === normalizedCurrentDay.toLowerCase()
  })

  console.log(`📅 [DayMatch] ${normalizedCurrentDay} vs [${scheduleDays.join(',')}] -> ${match}`)
  return match
}

/**
 * Verifica si un producto está disponible en un momento específico
 * @param product - Producto a verificar
 * @param checkDate - Fecha a verificar (por defecto la actual)
 * @param checkTime - Hora a verificar en formato HH:mm (por defecto la hora actual)
 * @returns true si el producto está disponible en ese momento
 */
export function isProductAvailableBySchedule(
  product: Product | null | undefined,
  checkDate: Date = new Date(),
  checkTime?: string
): boolean {
  // Logs para depuración en Ecuador
  console.log('🔍 [AvailabilityCheck] Verificando producto:', product?.name)

  // Logs para depuración en Ecuador
  console.log('🔍 [AvailabilityCheck] Verificando producto:', product?.name, {
    isAvailable: product?.isAvailable,
    hasSchedule: !!product?.scheduleAvailability,
    scheduleEnabled: product?.scheduleAvailability?.enabled,
    schedulesCount: product?.scheduleAvailability?.schedules?.length,
    fullData: product?.scheduleAvailability
  })

  if (!product) return false

  // No fallar si es undefined (caso de carritos viejos), solo si explícitamente es false.
  if (product.isAvailable === false) {
    console.log('❌ [AvailabilityCheck] Producto no disponible globalmente')
    return false
  }

  if (!product.scheduleAvailability?.enabled || !product.scheduleAvailability.schedules?.length) {
    console.log('ℹ️ [AvailabilityCheck] Sin restricciones de horario para:', product.name)
    return true
  }

  const timeToCheck = checkTime || getCurrentTimeString()
  const dayToCheck = getDayOfWeek(checkDate)

  console.log('📅 [AvailabilityCheck] Fecha/Hora consulta:', {
    checkDate: checkDate.toDateString(),
    dayToCheck,
    timeToCheck,
    schedules: product.scheduleAvailability.schedules
  })

  const isAvailable = product.scheduleAvailability.schedules.some(schedule => {
    const dayMatch = isDayMatching(dayToCheck, schedule.days)
    const timeMatch = isTimeInRange(timeToCheck, schedule.startTime, schedule.endTime)

    console.log(`⏰ [AvailabilityCheck] Comparando con schedule ${schedule.id}:`, {
      days: schedule.days,
      range: `${schedule.startTime}-${schedule.endTime}`,
      dayMatch,
      timeMatch
    })

    return dayMatch && timeMatch
  })

  console.log(`✅ [AvailabilityCheck] Resultado final para ${product.name}: ${isAvailable}`)
  return isAvailable
}

/**
 * Obtiene la hora actual en formato HH:mm
 */
export function getCurrentTimeString(): string {
  const now = new Date()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * Formatea los horarios de un producto para mostrar al usuario de forma amigable
 */
export function formatProductSchedule(product: Product): string {
  if (!product.scheduleAvailability?.enabled || !product.scheduleAvailability.schedules?.length) {
    return 'Disponible siempre'
  }

  const dayTranslations: Record<string, string> = {
    Monday: 'Lunes', Tuesday: 'Martes', Wednesday: 'Miércoles', Thursday: 'Jueves',
    Friday: 'Viernes', Saturday: 'Sábado', Sunday: 'Domingo',
    Mon: 'Lunes', Tue: 'Martes', Wed: 'Miércoles', Thu: 'Jueves',
    Fri: 'Viernes', Sat: 'Sábado', Sun: 'Domingo'
  }

  // Agrupar horarios por rangos iguales si es necesario, o listar simple
  return product.scheduleAvailability.schedules.map(s => {
    const days = s.days.map(d => dayTranslations[d] || d).join(', ')
    return `${days} de ${s.startTime} a ${s.endTime}`
  }).join(' | ')
}

/**
 * Verifica si todos los productos de un carrito están disponibles en un día/hora específico
 * @param products - Array de productos
 * @param checkDate - Fecha a verificar
 * @param checkTime - Hora a verificar
 * @returns objeto con resultado y lista de objetos de productos no disponibles
 */
export function checkCartAvailability(
  products: Product[],
  checkDate: Date,
  checkTime?: string
): { available: boolean; unavailableProducts: Array<{ name: string; scheduleText: string }> } {
  const unavailableProducts: Array<{ name: string; scheduleText: string }> = []

  products.forEach(product => {
    if (!isProductAvailableBySchedule(product, checkDate, checkTime)) {
      unavailableProducts.push({
        name: product.name,
        scheduleText: formatProductSchedule(product)
      })
    }
  })

  return {
    available: unavailableProducts.length === 0,
    unavailableProducts
  }
}

/**
 * Obtiene los próximos horarios disponibles de un producto
 * @param product - Producto a revisar
 * @param maxDaysAhead - Máximo de días a revisar hacia adelante
 * @returns Array de fechas y horarios disponibles
 */
export function getNextAvailableSlots(
  product: Product,
  maxDaysAhead: number = 7
): Array<{ date: Date; timeSlots: string[] }> {
  if (!product.isAvailable || !product.scheduleAvailability?.enabled) {
    return []
  }

  const slots: Array<{ date: Date; timeSlots: string[] }> = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = 0; i < maxDaysAhead; i++) {
    const checkDate = new Date(today)
    checkDate.setDate(checkDate.getDate() + i)
    const dayName = getDayOfWeek(checkDate)

    const matchingSchedules = product.scheduleAvailability.schedules.filter(
      schedule => isDayMatching(dayName, schedule.days)
    )

    if (matchingSchedules.length > 0) {
      const timeSlots = matchingSchedules.map(s => `${s.startTime} - ${s.endTime}`)
      // Eliminar duplicados
      const uniqueTimeSlots = Array.from(new Set(timeSlots))
      slots.push({
        date: checkDate,
        timeSlots: uniqueTimeSlots
      })
    }
  }

  return slots
}

/**
 * Formatea un mensaje amigable sobre disponibilidad de un producto
 */
export function formatAvailabilityMessage(product: Product): string {
  if (!product.isAvailable) {
    return 'Este producto no está disponible'
  }

  if (!product.scheduleAvailability?.enabled || !product.scheduleAvailability.schedules?.length) {
    return 'Disponible'
  }

  const nextSlots = getNextAvailableSlots(product, 1)
  if (nextSlots.length === 0) {
    return 'No disponible hoy'
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (nextSlots[0].date.getTime() === today.getTime()) {
    // Disponible hoy
    return `Disponible hoy: ${nextSlots[0].timeSlots.join(', ')}`
  } else {
    // Disponible otro día
    const dayName = getDayOfWeek(nextSlots[0].date)
    return `Disponible ${dayName}: ${nextSlots[0].timeSlots.join(', ')}`
  }
}

/**
 * Calcula el próximo slot disponible considerando tanto el horario de la tienda 
 * como las restricciones específicas por producto en el carrito.
 */
export function getNextAvailableSlotForCart(
  products: Product[],
  business: Business | null,
  maxDaysAhead: number = 7
): { date: string; time: string } | null {
  if (!business) return null

  // 1. Empezamos con el slot base de la tienda (abre hoy o mañana)
  const storeBaseSlot = getNextAvailableSlot(business)

  // 2. Identificar productos con restricciones de horario activas
  const restrictedProducts = products.filter(p => p.scheduleAvailability?.enabled && p.scheduleAvailability.schedules?.length > 0)

  // Si no hay productos restringidos, usamos el slot base de la tienda
  if (restrictedProducts.length === 0) {
    return storeBaseSlot
  }

  const now = new Date()
  const bufferMinutes = 30 // Margen de seguridad para pedidos programados

  // 3. Buscar el primer slot disponible en los próximos 7 días que satisfaga a TODOS
  for (let i = 0; i < maxDaysAhead; i++) {
    const checkDate = new Date(now)
    checkDate.setDate(checkDate.getDate() + i)
    const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`

    // Obtener horarios de la tienda para este día
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const storeSchedule = business.schedule?.[dayNames[checkDate.getDay()]]
    if (!storeSchedule || !storeSchedule.isOpen) continue

    // Recopilar todos los startTimes de todos los productos restringidos para este día
    const possibleStartTimes = new Set<string>()
    possibleStartTimes.add(storeSchedule.open)

    // Si es hoy, considerar el tiempo actual + buffer
    if (i === 0) {
      const bufferDate = new Date(now.getTime() + bufferMinutes * 60000)
      const hStr = String(bufferDate.getHours()).padStart(2, '0')
      const mStr = String(bufferDate.getMinutes()).padStart(2, '0')
      possibleStartTimes.add(`${hStr}:${mStr}`)
    }

    restrictedProducts.forEach(p => {
      p.scheduleAvailability?.schedules.forEach(s => {
        if (isDayMatching(getDayOfWeek(checkDate), s.days)) {
          possibleStartTimes.add(s.startTime)
        }
      })
    })

    const sortedTimes = Array.from(possibleStartTimes).sort()

    for (const time of sortedTimes) {
      // a) La tienda debe estar abierta
      if (!isSpecificTimeOpen(business, dateStr, time)) continue

      // b) Si es hoy, debe ser el futuro (ya lo cubrimos con el sortedTimes, pero por seguridad)
      if (i === 0) {
        const [h, m] = time.split(':').map(Number)
        const candidateDate = new Date(checkDate)
        candidateDate.setHours(h, m, 0, 0)
        if (candidateDate < new Date(now.getTime() + bufferMinutes * 60000)) continue
      }

      // c) Todos los productos deben estar disponibles en esa hora exacta
      const isEveryoneReady = restrictedProducts.every(p => isProductAvailableBySchedule(p, checkDate, time))

      if (isEveryoneReady) {
        return { date: dateStr, time }
      }
    }
  }

  // 4. Fallback si no hay match claro (devolvemos el base de la tienda aunque de error porducto, el usuario lo arreglará)
  return storeBaseSlot
}
