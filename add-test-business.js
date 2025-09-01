// Script para agregar un negocio de prueba con username para testing de rutas amigables

import { addDoc, collection } from 'firebase/firestore'
import { db } from './src/lib/firebase.js'

const testBusiness = {
  name: "Burger Palace",
  username: "burger-palace",
  description: "Deliciosas hamburguesas artesanales con ingredientes frescos y papas crujientes. ¡La mejor experiencia gastronómica de la ciudad!",
  address: "Av. Principal 123, Centro Comercial Plaza Norte",
  phone: "0990815097",
  email: "info@burgerpalace.com",
  ownerId: "test_owner_123",
  image: "https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=800&h=600&fit=crop&crop=center",
  categories: ["Hamburguesas", "Comida Rápida", "Americana"],
  mapLocation: {
    lat: -0.180653,
    lng: -78.467834
  },
  references: "Frente al banco Pichincha, local 15",
  bankAccount: {
    bankName: "Banco Pichincha",
    accountType: "Ahorros",
    accountNumber: "1234567890",
    accountHolder: "Burger Palace S.A."
  },
  schedule: {
    monday: { open: "10:00", close: "22:00", isOpen: true },
    tuesday: { open: "10:00", close: "22:00", isOpen: true },
    wednesday: { open: "10:00", close: "22:00", isOpen: true },
    thursday: { open: "10:00", close: "22:00", isOpen: true },
    friday: { open: "10:00", close: "23:00", isOpen: true },
    saturday: { open: "10:00", close: "23:00", isOpen: true },
    sunday: { open: "11:00", close: "21:00", isOpen: true }
  },
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date()
}

async function addTestBusiness() {
  try {
    console.log('Adding test business...')
    const docRef = await addDoc(collection(db, 'businesses'), testBusiness)
    console.log('✅ Test business added with ID:', docRef.id)
    console.log('🔗 Test URL: http://localhost:3000/burger-palace')
    
    // También agregar algunos productos de ejemplo
    const testProducts = [
      {
        businessId: docRef.id,
        name: "Burger Clásica",
        description: "Hamburguesa con carne de res, lechuga, tomate, cebolla y salsa especial",
        price: 8.50,
        category: "Hamburguesas",
        image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=300&fit=crop",
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        businessId: docRef.id,
        name: "Burger BBQ",
        description: "Hamburguesa con carne, bacon, queso cheddar y salsa BBQ",
        price: 10.00,
        category: "Hamburguesas",
        image: "https://images.unsplash.com/photo-1565299624946-b28f40a0ca4b?w=400&h=300&fit=crop",
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        businessId: docRef.id,
        name: "Papas Fritas",
        description: "Papas crujientes cortadas a mano con sal marina",
        price: 3.50,
        category: "Acompañamientos",
        image: "https://images.unsplash.com/photo-1576107232684-1279f390859f?w=400&h=300&fit=crop",
        isAvailable: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]

    for (const product of testProducts) {
      await addDoc(collection(db, 'products'), product)
    }
    
    console.log('✅ Test products added')
  } catch (error) {
    console.error('❌ Error adding test business:', error)
  }
}

// Ejecutar solo si se ejecuta directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  addTestBusiness()
}

export { addTestBusiness }
