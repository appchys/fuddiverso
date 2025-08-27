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
 * Obtiene el mensaje de error específico para un número de celular
 */
export const getPhoneValidationMessage = (phone: string): string | null => {
  if (!phone) {
    return PHONE_VALIDATION_MESSAGES.REQUIRED
  }
  
  const cleaned = cleanPhoneNumber(phone)
  
  if (cleaned.length < 10) {
    return PHONE_VALIDATION_MESSAGES.TOO_SHORT
  }
  
  if (cleaned.length > 10) {
    return PHONE_VALIDATION_MESSAGES.TOO_LONG
  }
  
  if (!cleaned.startsWith('09')) {
    return PHONE_VALIDATION_MESSAGES.INVALID_PREFIX
  }
  
  if (!validateEcuadorianPhone(cleaned)) {
    return PHONE_VALIDATION_MESSAGES.INVALID_FORMAT
  }
  
  return null
}
