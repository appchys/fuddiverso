// Utilidades para validación de datos ecuatorianos

/**
 * Valida un número de celular ecuatoriano
 * Formato esperado: 09XXXXXXXX (10 dígitos empezando con 09)
 */
export const validateEcuadorianPhone = (phone: string): boolean => {
  const phoneRegex = /^09[0-9]{8}$/
  return phoneRegex.test(phone)
}

/**
 * Formatea un número de celular ecuatoriano para mostrar
 * Convierte 0990815097 a 099 081 5097
 */
export const formatEcuadorianPhone = (phone: string): string => {
  if (!validateEcuadorianPhone(phone)) {
    return phone
  }
  
  return `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`
}

/**
 * Limpia un número de celular removiendo espacios y caracteres especiales
 * Mantiene solo los dígitos
 */
export const cleanPhoneNumber = (phone: string): string => {
  return phone.replace(/\D/g, '')
}

/**
 * Valida si un número de celular es válido después de limpiar
 */
export const isValidEcuadorianPhone = (phone: string): boolean => {
  const cleaned = cleanPhoneNumber(phone)
  return validateEcuadorianPhone(cleaned)
}

/**
 * Mensajes de error para validación de celular
 */
export const PHONE_VALIDATION_MESSAGES = {
  REQUIRED: 'El número de celular es obligatorio',
  INVALID_FORMAT: 'Ingrese un número de celular ecuatoriano válido (10 dígitos empezando con 09)',
  TOO_SHORT: 'El número de celular debe tener 10 dígitos',
  TOO_LONG: 'El número de celular debe tener 10 dígitos',
  INVALID_PREFIX: 'El número de celular debe empezar con 09'
}

/**
 * Normaliza un número de celular ecuatoriano al formato de la base de datos
 * Convierte diferentes formatos de entrada al formato estándar: 09XXXXXXXX
 * 
 * Formatos soportados:
 * - +593959036708 -> 0959036708
 * - +593 95 903 6708 -> 0959036708
 * - +593 95 903 6708 -> 0959036708
 * - 0959036708 -> 0959036708 (ya normalizado)
 * - 959036708 -> 0959036708 (sin el 0 inicial)
 */
export const normalizeEcuadorianPhone = (phone: string): string => {
  if (!phone) return ''
  
  // Remover todos los espacios, guiones y otros caracteres especiales
  let cleaned = phone.replace(/[\s\-\(\)]/g, '')
  
  // Si empieza con +593, remover el código de país
  if (cleaned.startsWith('+593')) {
    cleaned = cleaned.substring(4)
    // Agregar el 0 al inicio si no está presente
    if (!cleaned.startsWith('0')) {
      cleaned = '0' + cleaned
    }
  }
  // Si empieza con 593 (sin +), remover el código de país
  else if (cleaned.startsWith('593') && cleaned.length > 10) {
    cleaned = cleaned.substring(3)
    // Agregar el 0 al inicio si no está presente
    if (!cleaned.startsWith('0')) {
      cleaned = '0' + cleaned
    }
  }
  // Si tiene 9 dígitos y empieza con 9, agregar el 0 inicial
  else if (cleaned.length === 9 && cleaned.startsWith('9')) {
    cleaned = '0' + cleaned
  }
  
  // Mantener solo los dígitos
  cleaned = cleaned.replace(/\D/g, '')
  
  return cleaned
}

/**
 * Valida y normaliza un número de celular ecuatoriano
 * Retorna el número normalizado si es válido, null si no es válido
 */
export const validateAndNormalizePhone = (phone: string): string | null => {
  const normalized = normalizeEcuadorianPhone(phone)
  
  if (validateEcuadorianPhone(normalized)) {
    return normalized
  }
  
  return null
}

/**
 * Obtiene el mensaje de error específico para un número de celular
 */
export const getPhoneValidationMessage = (phone: string): string | null => {
  if (!phone) {
    return PHONE_VALIDATION_MESSAGES.REQUIRED
  }
  
  const normalized = normalizeEcuadorianPhone(phone)
  
  if (normalized.length < 10) {
    return PHONE_VALIDATION_MESSAGES.TOO_SHORT
  }
  
  if (normalized.length > 10) {
    return PHONE_VALIDATION_MESSAGES.TOO_LONG
  }
  
  if (!normalized.startsWith('09')) {
    return PHONE_VALIDATION_MESSAGES.INVALID_PREFIX
  }
  
  if (!validateEcuadorianPhone(normalized)) {
    return PHONE_VALIDATION_MESSAGES.INVALID_FORMAT
  }
  
  return null
}
