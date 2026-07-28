/**
 * Formatea una fecha o Timestamp de Firestore a formato relativo en español
 * Ejemplos: "Hace un momento", "Hace 45 min", "Hace 2 horas", "Ayer", "Hace 3 días", "Hace 1 mes"
 */
export function formatRelativeTime(dateInput: any): string {
  if (!dateInput) return ''
  
  let date: Date
  if (typeof dateInput === 'object' && typeof dateInput.seconds === 'number') {
    date = new Date(dateInput.seconds * 1000)
  } else if (typeof dateInput === 'object' && typeof dateInput.toDate === 'function') {
    date = dateInput.toDate()
  } else if (dateInput instanceof Date) {
    date = dateInput
  } else {
    date = new Date(dateInput)
  }
  
  if (isNaN(date.getTime())) return ''

  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  
  if (diffInSeconds < 60) {
    return 'Hace un momento'
  }
  
  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes < 60) {
    return diffInMinutes === 1 ? 'Hace 1 min' : `Hace ${diffInMinutes} min`
  }

  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) {
    return diffInHours === 1 ? 'Hace 1 hora' : `Hace ${diffInHours} horas`
  }

  // Verificar si es Ayer
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86400000
  const dateTime = date.getTime()

  if (dateTime >= startOfYesterday && dateTime < startOfToday) {
    return 'Ayer'
  }

  const diffInDays = Math.floor(diffInSeconds / 86400)
  if (diffInDays < 7) {
    return `Hace ${diffInDays} días`
  }

  const diffInWeeks = Math.floor(diffInDays / 7)
  if (diffInWeeks < 4) {
    return diffInWeeks === 1 ? 'Hace 1 semana' : `Hace ${diffInWeeks} semanas`
  }

  const diffInMonths = Math.floor(diffInDays / 30)
  if (diffInMonths < 12) {
    return diffInMonths === 1 ? 'Hace 1 mes' : `Hace ${diffInMonths} meses`
  }

  const diffInYears = Math.floor(diffInDays / 365)
  return diffInYears === 1 ? 'Hace 1 año' : `Hace ${diffInYears} años`
}
