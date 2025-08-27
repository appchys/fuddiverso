// Test script para verificar la normalización de números de celular ecuatorianos

// Simular las funciones de validación
const normalizeEcuadorianPhone = (phone) => {
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

const validateEcuadorianPhone = (phone) => {
  const phoneRegex = /^09[0-9]{8}$/
  return phoneRegex.test(phone)
}

// Casos de prueba
const testCases = [
  '0959036708',           // Ya normalizado
  '+593959036708',        // Con código de país
  '+593 95 903 6708',     // Con espacios
  '+593-95-903-6708',     // Con guiones
  '593959036708',         // Sin + pero con código
  '959036708',            // Sin 0 inicial
  '+593 95 903 6708 ',    // Con espacios al final
  '0959036708',           // Número original de ejemplo
]

console.log('🧪 Pruebas de normalización de números ecuatorianos:')
console.log('=' .repeat(60))

testCases.forEach((testPhone, index) => {
  const normalized = normalizeEcuadorianPhone(testPhone)
  const isValid = validateEcuadorianPhone(normalized)
  
  console.log(`${index + 1}. "${testPhone}"`)
  console.log(`   → Normalizado: "${normalized}"`)
  console.log(`   → Válido: ${isValid ? '✅' : '❌'}`)
  console.log('')
})

// Verificar que todos los casos válidos resulten en '0959036708'
const expectedResult = '0959036708'
const allCorrect = testCases.every(testPhone => {
  const normalized = normalizeEcuadorianPhone(testPhone)
  return normalized === expectedResult && validateEcuadorianPhone(normalized)
})

console.log(`🎯 Resultado final: ${allCorrect ? '✅ Todas las pruebas pasaron' : '❌ Algunas pruebas fallaron'}`)
console.log(`📱 Número esperado en BD: "${expectedResult}"`)
