'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

export default function RestaurantPage() {
  const params = useParams()
  const [cart, setCart] = useState<any[]>([])

  // Datos simulados del restaurante
  const restaurant = {
    id: params.id,
    name: 'Burger Palace',
    description: 'Las mejores hamburguesas de la ciudad',
    image: '/placeholder-restaurant.jpg',
    rating: 4.5,
    deliveryTime: '25-35 min',
    address: 'Av. Principal, Centro Comercial Plaza',
    phone: '0990815097',
    isOpen: true,
    schedule: {
      lunes: { open: '11:00', close: '22:00', isOpen: true },
      martes: { open: '11:00', close: '22:00', isOpen: true },
      miércoles: { open: '11:00', close: '22:00', isOpen: true },
      jueves: { open: '11:00', close: '22:00', isOpen: true },
      viernes: { open: '11:00', close: '23:00', isOpen: true },
      sábado: { open: '11:00', close: '23:00', isOpen: true },
      domingo: { open: '12:00', close: '21:00', isOpen: true }
    }
  }

  const menu = [
    {
      category: 'Hamburguesas',
      items: [
        {
          id: '1',
          name: 'Hamburguesa Clásica',
          description: 'Carne de res, lechuga, tomate, cebolla, queso cheddar',
          price: 12,
          image: '/placeholder-food.jpg',
          isAvailable: true
        },
        {
          id: '2',
          name: 'Hamburguesa BBQ',
          description: 'Carne de res, salsa BBQ, cebolla caramelizada, queso suizo',
          price: 15,
          image: '/placeholder-food.jpg',
          isAvailable: true
        },
        {
          id: '3',
          name: 'Hamburguesa Veggie',
          description: 'Hamburguesa de frijoles negros, aguacate, lechuga, tomate',
          price: 10,
          image: '/placeholder-food.jpg',
          isAvailable: false
        }
      ]
    },
    {
      category: 'Acompañantes',
      items: [
        {
          id: '4',
          name: 'Papas Fritas',
          description: 'Papas crujientes con sal marina',
          price: 5,
          image: '/placeholder-food.jpg',
          isAvailable: true
        },
        {
          id: '5',
          name: 'Aros de Cebolla',
          description: 'Aros de cebolla empanizados y fritos',
          price: 6,
          image: '/placeholder-food.jpg',
          isAvailable: true
        }
      ]
    },
    {
      category: 'Bebidas',
      items: [
        {
          id: '6',
          name: 'Coca Cola',
          description: 'Refresco de cola 350ml',
          price: 3,
          image: '/placeholder-food.jpg',
          isAvailable: true
        },
        {
          id: '7',
          name: 'Agua',
          description: 'Agua mineral 500ml',
          price: 2,
          image: '/placeholder-food.jpg',
          isAvailable: true
        }
      ]
    }
  ]

  const addToCart = (item: any) => {
    const existingItem = cart.find(cartItem => cartItem.id === item.id)
    
    if (existingItem) {
      setCart(cart.map(cartItem => 
        cartItem.id === item.id 
          ? { ...cartItem, quantity: cartItem.quantity + 1, subtotal: (cartItem.quantity + 1) * item.price }
          : cartItem
      ))
    } else {
      setCart([...cart, { ...item, quantity: 1, subtotal: item.price }])
    }
  }

  const removeFromCart = (itemId: string) => {
    const existingItem = cart.find(cartItem => cartItem.id === itemId)
    
    if (existingItem && existingItem.quantity > 1) {
      setCart(cart.map(cartItem => 
        cartItem.id === itemId 
          ? { ...cartItem, quantity: cartItem.quantity - 1, subtotal: (cartItem.quantity - 1) * cartItem.price }
          : cartItem
      ))
    } else {
      setCart(cart.filter(cartItem => cartItem.id !== itemId))
    }
  }

  const getItemQuantity = (itemId: string) => {
    const item = cart.find(cartItem => cartItem.id === itemId)
    return item ? item.quantity : 0
  }

  const getTotalItems = () => {
    return cart.reduce((total, item) => total + item.quantity, 0)
  }

  const getTotalPrice = () => {
    return cart.reduce((total, item) => total + item.subtotal, 0)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Link href="/" className="text-gray-600 hover:text-red-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <Link href="/" className="text-2xl font-bold text-red-600">
                Fuddiverso
              </Link>
            </div>
            <Link
              href="/checkout"
              className="relative bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4m1.6 8L5 21h14a2 2 0 002-2V11a2 2 0 00-2-2H7m0 8v2a2 2 0 002 2h2a2 2 0 002-2v-2m-6 0V9a2 2 0 012-2h2a2 2 0 012 2v4"/>
              </svg>
              <span>Carrito ({getTotalItems()})</span>
              {getTotalItems() > 0 && (
                <span className="ml-2">${getTotalPrice()}</span>
              )}
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Restaurant Info */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex flex-col md:flex-row">
            <div className="md:w-2/3">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{restaurant.name}</h1>
              <p className="text-gray-600 mb-4">{restaurant.description}</p>
              
              <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                <div className="flex items-center">
                  <svg className="w-4 h-4 text-yellow-400 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                  </svg>
                  {restaurant.rating}
                </div>
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {restaurant.deliveryTime}
                </div>
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {restaurant.address}
                </div>
              </div>
            </div>
            
            <div className="md:w-1/3 mt-4 md:mt-0">
              <div className="bg-gradient-to-br from-red-400 to-orange-400 rounded-lg h-32 flex items-center justify-center">
                <svg className="w-16 h-16 text-white opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Menu */}
        <div className="space-y-8">
          {menu.map((category) => (
            <div key={category.category} className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">{category.category}</h2>
              
              <div className="space-y-4">
                {category.items.map((item) => (
                  <div key={item.id} className="flex justify-between items-center p-4 border border-gray-200 rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-start">
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold text-gray-900">{item.name}</h3>
                          <p className="text-gray-600 text-sm mt-1">{item.description}</p>
                          <p className="text-lg font-bold text-red-600 mt-2">${item.price}</p>
                        </div>
                        
                        <div className="ml-4 w-20 h-20 bg-gradient-to-br from-red-400 to-orange-400 rounded-lg flex items-center justify-center">
                          <svg className="w-8 h-8 text-white opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    
                    <div className="ml-6">
                      {!item.isAvailable ? (
                        <span className="text-gray-400 text-sm">No disponible</span>
                      ) : getItemQuantity(item.id) === 0 ? (
                        <button
                          onClick={() => addToCart(item)}
                          className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
                        >
                          Agregar
                        </button>
                      ) : (
                        <div className="flex items-center space-x-3">
                          <button
                            onClick={() => removeFromCart(item.id)}
                            className="bg-gray-200 text-gray-700 w-8 h-8 rounded-full hover:bg-gray-300"
                          >
                            -
                          </button>
                          <span className="font-semibold">{getItemQuantity(item.id)}</span>
                          <button
                            onClick={() => addToCart(item)}
                            className="bg-red-600 text-white w-8 h-8 rounded-full hover:bg-red-700"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Floating Cart Button - Mobile */}
        {getTotalItems() > 0 && (
          <div className="fixed bottom-4 left-4 right-4 md:hidden">
            <Link
              href="/checkout"
              className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold text-center block hover:bg-red-700"
            >
              Ver Carrito ({getTotalItems()}) - ${getTotalPrice()}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
