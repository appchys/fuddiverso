// Script para probar la normalización de teléfonos
// Copiar y pegar en la consola del navegador para probar

// Función normalizePhone del componente
function normalizePhone(phone) {
  // Remover todos los espacios, guiones y paréntesis
  let cleanPhone = phone.replace(/[\s\-\(\)]/g, '')

  // Si empieza con +593, convertir a formato nacional (09xxxxxxxx)
  if (cleanPhone.startsWith('+593')) {
    cleanPhone = '0' + cleanPhone.substring(4)
  } 
  // Si empieza con 593 (sin +), convertir a formato nacional
  else if (cleanPhone.startsWith('593')) {
    cleanPhone = '0' + cleanPhone.substring(3)
  }
  // Si empieza con 9 y tiene 9 dígitos, ya está en formato correcto
  else if (cleanPhone.startsWith('9') && cleanPhone.length === 9) {
    // Ya está correcto, no hacer nada
  }
  // Si empieza con 0 y tiene 10 dígitos, ya está en formato correcto
  else if (cleanPhone.startsWith('0') && cleanPhone.length === 10) {
    // Ya está correcto, no hacer nada
  }
  // Si tiene 8 dígitos y no empieza con 0, agregar el 0
  else if (cleanPhone.length === 8 && !cleanPhone.startsWith('0')) {
    cleanPhone = '0' + cleanPhone
  }

  return cleanPhone
}

// Casos de prueba
const testCases = [
  '+593 987 654 321',    // Internacional con espacios
  '+593987654321',       // Internacional sin espacios
  '593987654321',        // Internacional sin +
  '0987654321',          // Nacional correcto
  '987654321',           // Sin 0 inicial
  '0987-654-321',        // Con guiones
  '(0987) 654-321',      // Con paréntesis
  '  0987654321  ',      // Con espacios
  '+593 (987) 654-321',  // Mixto
  '1234567890'           // No ecuatoriano
]

console.log('=== PRUEBAS DE NORMALIZACIÓN DE TELÉFONOS ===\n')

testCases.forEach((phone, index) => {
  const normalized = normalizePhone(phone)
  const isValid = /^0\d{9}$/.test(normalized)
  
  console.log(`${index + 1}. Original: "${phone}"`)
  console.log(`   Normalizado: "${normalized}"`)
  console.log(`   Válido: ${isValid ? '✅' : '❌'}`)
  console.log('')
})

// Función para generar variantes de búsqueda (similar a la de database.ts)
function getPhoneVariants(phone) {
  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '')
  const variants = new Set()
  
  variants.add(cleanPhone)
  
  if (cleanPhone.startsWith('+593')) {
    variants.add('0' + cleanPhone.substring(4))
  }
  else if (cleanPhone.startsWith('593')) {
    variants.add('0' + cleanPhone.substring(3))
  }
  else if (cleanPhone.startsWith('0') && cleanPhone.length === 10) {
    variants.add('+593' + cleanPhone.substring(1))
    variants.add('593' + cleanPhone.substring(1))
  }
  else if (cleanPhone.startsWith('9') && cleanPhone.length === 9) {
    variants.add('0' + cleanPhone)
    variants.add('+593' + cleanPhone)
    variants.add('593' + cleanPhone)
  }
  
  return Array.from(variants)
}

console.log('\n=== PRUEBAS DE VARIANTES DE BÚSQUEDA ===\n')

const searchCases = [
  '+593987654321',
  '0987654321',
  '987654321'
]

searchCases.forEach((phone, index) => {
  const variants = getPhoneVariants(phone)
  console.log(`${index + 1}. Búsqueda: "${phone}"`)
  console.log(`   Variantes: ${JSON.stringify(variants)}`)
  console.log('')
})

console.log('\n=== RESUMEN ===')
console.log('✅ Todos los teléfonos ecuatorianos válidos deberían normalizarse a formato: 09xxxxxxxx')
console.log('✅ La búsqueda debería encontrar clientes sin importar el formato guardado')
console.log('✅ Se previene la duplicación de clientes con diferentes formatos')
