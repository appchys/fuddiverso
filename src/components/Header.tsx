'use client'

import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'
import { useState, useEffect, forwardRef, useImperativeHandle, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { searchClientByPhone, searchBusinesses, getAllBusinesses, createClient, setClientPin, updateClient } from '@/lib/database'
import { storage } from '@/lib/firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'
import ClientLoginModal from '@/components/ClientLoginModal'
import UserSidebar from './UserSidebar'

// Componente para mostrar carritos activos
function CartIndicator() {
  const [activeCarts, setActiveCarts] = useState<{ [key: string]: any[] }>({})
  const [showDropdown, setShowDropdown] = useState(false)

  useEffect(() => {
    const loadCarts = () => {
      const cartsData = localStorage.getItem('carts')
      if (cartsData) {
        try {
          const allCarts = JSON.parse(cartsData)
          // Filtrar solo carritos que tienen productos
          const filteredCarts: { [key: string]: any[] } = {}
          Object.entries(allCarts).forEach(([businessId, cart]: [string, any]) => {
            if (Array.isArray(cart) && cart.length > 0) {
              filteredCarts[businessId] = cart
            }
          })
          setActiveCarts(filteredCarts)
        } catch (e) {
          console.error('Error parsing carts:', e)
        }
      }
    }

    loadCarts()

    // Escuchar cambios en localStorage
    const handleStorageChange = () => loadCarts()
    window.addEventListener('storage', handleStorageChange)

    // También verificar cada segundo para cambios locales
    const interval = setInterval(loadCarts, 1000)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      clearInterval(interval)
    }
  }, [])

  const activeCartsCount = Object.keys(activeCarts).length
  const totalItems = Object.values(activeCarts).reduce((total, cart) =>
    total + cart.reduce((sum, item) => sum + item.quantity, 0), 0
  )

  const handleDeleteCart = (businessId: string) => {
    try {
      const cartsData = localStorage.getItem('carts')
      if (!cartsData) return
      const allCarts = JSON.parse(cartsData)
      if (allCarts[businessId]) {
        delete allCarts[businessId]
        localStorage.setItem('carts', JSON.stringify(allCarts))
        // Update local state immediately
        setActiveCarts(prev => {
          const copy = { ...prev }
          delete copy[businessId]
          return copy
        })
      }
    } catch (e) {
      console.error('Error deleting cart for business:', businessId, e)
    }
  }

  if (activeCartsCount === 0) return null

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <i className="bi bi-bag text-xl"></i>
        {totalItems > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
            {totalItems > 99 ? '99+' : totalItems}
          </span>
        )}
      </button>

      {showDropdown && (
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-lg border z-50 max-h-96 overflow-y-auto">
          <div className="p-3 border-b bg-gray-50">
            <h3 className="font-semibold text-gray-900">Carritos Activos</h3>
            <p className="text-sm text-gray-600">{activeCartsCount} {activeCartsCount === 1 ? 'tienda' : 'tiendas'}</p>
          </div>

          <div className="divide-y">
            {Object.entries(activeCarts).map(([businessId, cart]) => {
              const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
              const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0)
              const businessName = cart[0]?.businessName || 'Tienda'
              const logo = cart[0]?.businessImage || '/default-restaurant-og.svg'

              return (
                <div key={businessId} className="p-3 hover:bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center min-w-0">
                      <img src={logo} alt={businessName} className="w-6 h-6 rounded object-cover mr-2" />
                      <h4 className="font-medium text-gray-900 text-sm truncate">{businessName}</h4>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-red-600">${cartTotal.toFixed(2)}</span>
                      <button
                        aria-label="Eliminar carrito"
                        onClick={() => handleDeleteCart(businessId)}
                        className="p-1 text-gray-400 hover:text-red-600 rounded"
                        title="Eliminar"
                      >
                        <i className="bi bi-trash text-base"></i>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{cartItemsCount} productos</span>
                    <Link
                      href={`/checkout?businessId=${businessId}`}
                      className="text-xs bg-red-500 text-white px-3 py-1 rounded-lg hover:bg-red-600 transition-colors"
                      onClick={() => setShowDropdown(false)}
                    >
                      Finalizar Pedido
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// Componente para mostrar carritos en el menú de perfil
// CartIndicator and other components below...

type HeaderProps = {
  initialShowLoginModal?: boolean;
}

export default function Header({ initialShowLoginModal = false }: HeaderProps) {
  const { user, logout } = useAuth()
  const [isUserSidebarOpen, setIsUserSidebarOpen] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(initialShowLoginModal)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [categories, setCategories] = useState<string[]>(['all'])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const router = useRouter()
  const pathname = usePathname()

  // Cargar categorías

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const businesses = await getAllBusinesses()
        const uniqueCategories = new Set<string>()
        businesses.forEach(business => {
          if (business.categories && business.categories.length > 0) {
            business.categories.forEach((category: string) => uniqueCategories.add(category))
          }
        })
        setCategories(['all', ...Array.from(uniqueCategories).sort()])
      } catch (error) {
        console.error('Error loading categories:', error)
      }
    }
    loadCategories()
  }, [])

  const handleSearch = () => {
    if (searchTerm.trim() || selectedCategory !== 'all') {
      const params = new URLSearchParams()
      if (searchTerm.trim()) params.set('search', searchTerm)
      if (selectedCategory !== 'all') params.set('category', selectedCategory)
      router.push(`/?${params.toString()}`)
    } else {
      router.push('/')
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  // No mostrar header en rutas de business
  if (pathname.startsWith('/business')) {
    return null
  }

  // CAMBIO: Agregada limpieza de localStorage para resetear datos del cliente
  const handleLogout = () => {
    logout()
    // Limpiar datos de cliente en localStorage para que el modal quede vacío al reabrir
    localStorage.removeItem('loginPhone')
    localStorage.removeItem('clientData')
    // Opcional: Limpiar carritos si quieres resetear todo al logout (descomenta si aplica)
    // localStorage.removeItem('carts')
    setIsUserSidebarOpen(false)
    router.push('/')
  }

  const handleLoginSuccess = (client: any) => {
    setShowLoginModal(false)
    // El login ya se maneja en ClientLoginModal
  }

  // Función para obtener las iniciales del nombre
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <>
      <header className="bg-white shadow-sm border-b fixed top-0 left-0 right-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center flex-shrink-0">
              <h1 className="text-xl sm:text-2xl font-bold text-orange-600">Fuddi</h1>
            </Link>

            {/* Barra de búsqueda - Desktop */}
            {pathname === '/' && (
              <div className="flex-1 max-w-2xl mx-4 hidden md:block">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Buscar restaurantes o comida..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onKeyPress={handleKeyPress}
                      className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                    />
                  </div>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm min-w-[120px]"
                  >
                    {categories.map(category => (
                      <option key={category} value={category}>
                        {category === 'all' ? 'Todas' : category}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleSearch}
                    className="bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors text-sm"
                  >
                    <i className="bi bi-search"></i>
                  </button>
                </div>
              </div>
            )}

            {/* User Profile */}
            <div className="flex items-center space-x-4">
              {/* Botón de búsqueda móvil */}
              {pathname === '/' && (
                <button
                  onClick={() => setShowMobileSearch(!showMobileSearch)}
                  className="md:hidden p-2 text-gray-600 hover:text-orange-600 transition-colors"
                >
                  <i className="bi bi-search text-lg"></i>
                </button>
              )}

              <div className="relative">
                <button
                  onClick={() => setIsUserSidebarOpen(true)}
                  className="flex items-center space-x-2 p-1 rounded-full hover:bg-gray-100 transition-colors group"
                  aria-label="Menú de usuario"
                >
                  {user ? (
                    <>
                      {/* Contenedor del avatar */}
                      <div className="relative w-9 h-9">
                        {/* Imagen de perfil - solo se muestra si hay photoURL */}
                        {user.photoURL && (
                          <img
                            src={user.photoURL}
                            alt={user.nombres || 'Usuario'}
                            className="w-full h-full rounded-full object-cover"
                            onError={(e) => {
                              // Si falla la carga de la imagen, forzamos mostrar las iniciales
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              const initials = target.nextElementSibling as HTMLElement;
                              if (initials) initials.style.display = 'flex';
                            }}
                          />
                        )}
                        {/* Iniciales - siempre presentes pero ocultas si hay imagen */}
                        <div
                          className={`w-full h-full rounded-full bg-orange-500 flex items-center justify-center text-white text-xs font-black shadow-inner ${user.photoURL ? 'hidden' : 'flex'}`}
                        >
                          {user.nombres ? user.nombres.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() : 'U'}
                        </div>
                      </div>
                      <i className="bi bi-chevron-down text-gray-400 text-xs group-hover:text-gray-600 transition-colors"></i>
                    </>
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 border border-gray-200 group-hover:bg-gray-200 transition-colors">
                      <i className="bi bi-person text-xl"></i>
                    </div>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Navigation - Removed as requested */}
        <div className="md:hidden border-t bg-white" style={{ display: 'none' }}>
          {/* Mobile navigation removed */}
        </div>

        {/* Búsqueda móvil desplegable */}
        {showMobileSearch && pathname === '/' && (
          <div className="md:hidden bg-white border-t border-gray-200 p-4">
            <div className="space-y-3">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Buscar restaurantes o comida..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="flex-1 px-3 py-3 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  {categories.map(category => (
                    <option key={category} value={category}>
                      {category === 'all' ? 'Todas las categorías' : category}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    handleSearch()
                    setShowMobileSearch(false)
                  }}
                  className="bg-orange-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-orange-600 transition-colors"
                >
                  Buscar
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <UserSidebar
        isOpen={isUserSidebarOpen}
        onClose={() => setIsUserSidebarOpen(false)}
        onLogin={() => setShowLoginModal(true)}
      />
    </>
  )
}