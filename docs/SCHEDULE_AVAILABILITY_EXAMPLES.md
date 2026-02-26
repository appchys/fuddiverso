// EJEMPLOS DE USO - Sistema de Disponibilidad por Horarios

// ============================================
// Ejemplo 1: Validar producto en el checkout
// ============================================

import { isProductAvailableBySchedule } from '@/lib/product-availability-utils'

function validateProductAvailability(product: Product) {
  const now = new Date()
  const currentHour = String(now.getHours()).padStart(2, '0')
  const currentMinute = String(now.getMinutes()).padStart(2, '0')
  const currentTime = `${currentHour}:${currentMinute}`

  if (!isProductAvailableBySchedule(product, now, currentTime)) {
    return {
      available: false,
      message: `${product.name} no está disponible en este momento`
    }
  }

  return { available: true }
}

// Uso:
const validation = validateProductAvailability(product)
if (!validation.available) {
  showError(validation.message)
}


// ============================================
// Ejemplo 2: Validar carrito completo
// ============================================

import { checkCartAvailability } from '@/lib/product-availability-utils'

function validateCheckout(cartItems: any[], scheduledDate?: Date, scheduledTime?: string) {
  const products = cartItems.map(item => item.product)
  const dateToCheck = scheduledDate || new Date()

  const result = checkCartAvailability(products, dateToCheck, scheduledTime)

  if (!result.available) {
    return {
      success: false,
      message: `Los siguientes productos no están disponibles: ${result.unavailableProducts.join(', ')}`
    }
  }

  return { success: true }
}

// Uso:
const checkoutValidation = validateCheckout(cartItems, scheduledDate, scheduledTime)
if (!checkoutValidation.success) {
  alert(checkoutValidation.message)
  return
}


// ============================================
// Ejemplo 3: Mostrar próximos horarios disponibles
// ============================================

import { getNextAvailableSlots, formatAvailabilityMessage } from '@/lib/product-availability-utils'

function displayNextAvailable(product: Product) {
  // Opción 1: Mensaje simple
  console.log(formatAvailabilityMessage(product))
  // Output: "Disponible hoy: 08:00 - 11:00"

  // Opción 2: Lista detallada
  const slots = getNextAvailableSlots(product, 7)

  return slots.map(slot => ({
    date: slot.date.toLocaleDateString('es-ES'),
    timeSlots: slot.timeSlots.join(', ')
  }))
  // Output:
  // [
  //   { date: '26/02/2025', timeSlots: '08:00 - 11:00, 14:00 - 20:00' },
  //   { date: '27/02/2025', timeSlots: '08:00 - 11:00, 14:00 - 20:00' }
  // ]
}


// ============================================
// Ejemplo 4: Integración en página de producto
// ============================================

'use client'
import { isProductAvailableBySchedule } from '@/lib/product-availability-utils'

export function ProductCard({ product }: { product: Product }) {
  const isAvailable = isProductAvailableBySchedule(product)

  return (
    <div className={isAvailable ? 'opacity-100' : 'opacity-50 grayscale'}>
      <img src={product.image} alt={product.name} />
      <h3>{product.name}</h3>
      <p>${product.price}</p>

      {!isAvailable && (
        <p className="text-red-600 text-sm">
          No disponible en este momento
        </p>
      )}

      <button 
        onClick={() => addToCart(product)}
        disabled={!isAvailable}
      >
        {isAvailable ? 'Agregar al carrito' : 'No disponible'}
      </button>
    </div>
  )
}


// ============================================
// Ejemplo 5: Validación en formulario de checkout
// ============================================

function handleScheduledOrderSubmit(
  cartItems: any[],
  scheduledDate: Date,
  scheduledTime: string
) {
  const products = cartItems.map(item => item.product)

  // Validar que todos los productos estén disponibles en la fecha/hora programada
  const validation = checkCartAvailability(products, scheduledDate, scheduledTime)

  if (!validation.available) {
    setError(
      `No puedes programar para esa hora. No disponibles: ${validation.unavailableProducts.join(', ')}`
    )
    return false
  }

  // Proceder con la orden
  submitOrder(cartItems)
  return true
}


// ============================================
// Ejemplo 6: Mostrar cuándo está disponible un producto
// ============================================

import React from 'react'
import { getNextAvailableSlots } from '@/lib/product-availability-utils'

export function ProductAvailabilityInfo({ product }: { product: Product }) {
  if (!product.scheduleAvailability?.enabled) {
    return <p>Disponible todos los días</p>
  }

  const slots = getNextAvailableSlots(product, 3)

  if (slots.length === 0) {
    return <p className="text-red-600">No disponible próximamente</p>
  }

  return (
    <div className="bg-blue-50 p-4 rounded">
      <h4 className="font-bold">Disponible en:</h4>
      <ul>
        {slots.map((slot, i) => (
          <li key={i}>
            {slot.date.toLocaleDateString('es-ES', { weekday: 'long' })}: {' '}
            {slot.timeSlots.join(', ')}
          </li>
        ))}
      </ul>
    </div>
  )
}


// ============================================
// Ejemplo 7: Filtro de productos disponibles ahora
// ============================================

import { isProductAvailableBySchedule } from '@/lib/product-availability-utils'

function getAvailableProductsNow(allProducts: Product[]): Product[] {
  return allProducts.filter(product => 
    isProductAvailableBySchedule(product)
  )
}

// Uso:
const availableNow = getAvailableProductsNow(allProducts)
console.log(`${availableNow.length} productos disponibles ahora`)


// ============================================
// Ejemplo 8: Crear horarios en el formulario
// ============================================

// En ProductList.tsx ya está implementado, pero aquí está la lógica:

const [schedules, setSchedules] = React.useState([])
const [currentSchedule, setCurrentSchedule] = React.useState({
  days: [] as string[],
  startTime: '09:00',
  endTime: '17:00'
})

const addSchedule = () => {
  if (currentSchedule.days.length === 0) return

  const newSchedule = {
    id: Date.now().toString(),
    ...currentSchedule
  }
  setSchedules(prev => [...prev, newSchedule])
  setCurrentSchedule({ days: [], startTime: '09:00', endTime: '17:00' })
}

// Al guardar el producto, incluir:
const productData = {
  name: product.name,
  // ... otros campos ...
  scheduleAvailability: {
    enabled: true,
    schedules: schedules
  }
}


// ============================================
// Ejemplo 9: Estructura de datos en Firestore
// ============================================

/*
Estructura del documento 'products/{productId}' en Firestore:

{
  "id": "prod_12345",
  "businessId": "biz_123",
  "name": "Desayuno Especial",
  "description": "Huevos, pan tostado y jugo",
  "price": 5.5,
  "category": "Desayunos",
  "isAvailable": true,
  "image": "https://...",
  "variants": [],
  "ingredients": [],
  
  // NUEVO: Configuración de horarios
  "scheduleAvailability": {
    "enabled": true,
    "schedules": [
      {
        "id": "sched_1",
        "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "startTime": "08:00",
        "endTime": "11:00"
      },
      {
        "id": "sched_2",
        "days": ["Saturday", "Sunday"],
        "startTime": "09:00",
        "endTime": "13:00"
      }
    ]
  },
  
  "createdAt": Timestamp(...)
  "updatedAt": Timestamp(...)
}
*/


// ============================================
// Ejemplo 10: Casos de error y mujeo
// ============================================

function handleAddToCart(product: Product) {
  // Validar disponibilidad actual
  if (!isProductAvailableBySchedule(product)) {
    // Obtener próximo horario disponible
    const nextSlots = getNextAvailableSlots(product, 1)
    
    if (nextSlots.length > 0) {
      const nextDate = nextSlots[0].date
      const times = nextSlots[0].timeSlots
      showMessage(
        `${product.name} estará disponible ${nextDate.toLocaleDateString('es-ES')} a las ${times}`
      )
    } else {
      showMessage(`${product.name} no está disponible próximamente`)
    }
    return
  }

  // Agregar al carrito
  addToCart(product)
  showSuccess(`${product.name} agregado al carrito`)
}


// ============================================
// SNIPPETS ÚTILES
// ============================================

// Obtener hora actual en formato HH:mm
function getCurrentTimeString(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

// Obtener día de la semana
function getDayOfWeek(date: Date = new Date()): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return days[date.getDay()]
}

// Comparar horas (devuelve -1 si time1 < time2, 0 si =, 1 si >)
function compareTime(time1: string, time2: string): number {
  const [h1, m1] = time1.split(':').map(Number)
  const [h2, m2] = time2.split(':').map(Number)
  const minutes1 = h1 * 60 + m1
  const minutes2 = h2 * 60 + m2
  return minutes1 < minutes2 ? -1 : minutes1 > minutes2 ? 1 : 0
}

// Verificar si una hora está en rango (soporta rangos que cruzan medianoche)
function isTimeInRange(currentTime: string, startTime: string, endTime: string): boolean {
  const [ch, cm] = currentTime.split(':').map(Number)
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)

  const current = ch * 60 + cm
  const start = sh * 60 + sm
  const end = eh * 60 + em

  // Si el rango cruza medianoche (ej: 22:00 - 06:00)
  if (start > end) {
    return current >= start || current <= end
  }

  // Rango normal
  return current >= start && current <= end
}
