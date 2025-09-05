'use client'

import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { searchClientByPhone, searchBusinesses, getAllBusinesses } from '@/lib/database'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'

// Componente para mostrar carritos activos
function CartIndicator() {
  const [activeCarts, setActiveCarts] = useState<{[key: string]: any[]}>({})
  const [showDropdown, setShowDropdown] = useState(false)

  useEffect(() => {
    const loadCarts = () => {
      const cartsData = localStorage.getItem('carts')
      if (cartsData) {
        try {
          const allCarts = JSON.parse(cartsData)
          // Filtrar solo carritos que tienen productos
          const filteredCarts: {[key: string]: any[]} = {}
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
              
              return (
                <div key={businessId} className="p-3 hover:bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-gray-900 text-sm">{businessName}</h4>
                    <span className="text-sm font-semibold text-red-600">${cartTotal.toFixed(2)}</span>
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

export default function Header() {
  const { user, login, logout } = useAuth()
  const [showDropdown, setShowDropdown] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [loginPhone, setLoginPhone] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
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
            business.categories.forEach(category => {
              uniqueCategories.add(category)
            })
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

  const handleLogout = () => {
    logout()
    setShowDropdown(false)
    router.push('/')
  }

  const handleLogin = async () => {
    if (!loginPhone.trim()) {
      setLoginError('Por favor ingresa tu número de teléfono')
      return
    }

    const normalizedPhone = normalizeEcuadorianPhone(loginPhone)
    if (!validateEcuadorianPhone(normalizedPhone)) {
      setLoginError('Ingrese un número de celular ecuatoriano válido')
      return
    }

    setLoginLoading(true)
    setLoginError('')

    try {
      const client = await searchClientByPhone(normalizedPhone)
      if (client) {
        login(client)
        setShowLoginModal(false)
        setLoginPhone('')
        alert('¡Bienvenido de vuelta!')
      } else {
        setLoginError('No encontramos una cuenta con este número. ¿Quieres registrarte?')
      }
    } catch (error) {
      setLoginError('Error al iniciar sesión. Intenta de nuevo.')
      console.error('Login error:', error)
    } finally {
      setLoginLoading(false)
    }
  }

  const openLoginModal = () => {
    setShowLoginModal(true)
    setLoginPhone('')
    setLoginError('')
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
              <h1 className="text-xl sm:text-2xl font-bold text-orange-600">fuddi.shop</h1>
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
              {/* Indicador de carritos activos */}
              <CartIndicator />
              
              {user ? (
                <div className="relative">
                  <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    className="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    {/* Avatar con iniciales */}
                    <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      {getInitials(user.nombres || 'Usuario')}
                    </div>
                    <span className="text-gray-700 text-sm font-medium hidden sm:block">
                      {user.nombres || 'Usuario'}
                    </span>
                    <i className="bi bi-chevron-down text-gray-400 text-xs"></i>
                  </button>

                  {/* Dropdown Menu */}
                  {showDropdown && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 border">
                      <div className="px-4 py-2 border-b">
                        <p className="text-sm font-medium text-gray-900">{user.nombres}</p>
                        <p className="text-sm text-gray-500">{user.celular}</p>
                      </div>
                      
                      <Link
                        href="/profile"
                        onClick={() => {
                          setShowDropdown(false)
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                      >
                        <i className="bi bi-person mr-2"></i>
                        Mi Perfil
                      </Link>
                      
                      <Link
                        href="/my-orders"
                        onClick={() => {
                          setShowDropdown(false)
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                      >
                        <i className="bi bi-bag mr-2"></i>
                        Mis Pedidos
                      </Link>
                      
                      <Link
                        href="/my-locations"
                        onClick={() => {
                          setShowDropdown(false)
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                      >
                        <i className="bi bi-geo-alt mr-2"></i>
                        Mis Ubicaciones
                      </Link>
                      
                      <div className="border-t">
                        <button
                          onClick={handleLogout}
                          className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100 flex items-center"
                        >
                          <i className="bi bi-box-arrow-right mr-2"></i>
                          Cerrar Sesión
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center space-x-3">
                  <Link 
                    href="/business/login"
                    className="text-gray-700 hover:text-orange-600 transition-colors text-sm font-medium"
                  >
                    Negocio
                  </Link>
                  <button 
                    onClick={openLoginModal}
                    className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors"
                  >
                    Iniciar Sesión
                  </button>
                </div>
              )}
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

      {/* Modal de Login */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Iniciar Sesión</h3>
              <button
                onClick={() => setShowLoginModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Número de teléfono
                </label>
                <input
                  type="tel"
                  value={loginPhone}
                  onChange={(e) => setLoginPhone(e.target.value)}
                  placeholder="0998765432"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                />
                {loginError && (
                  <p className="text-red-500 text-sm mt-1">{loginError}</p>
                )}
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setShowLoginModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleLogin}
                  disabled={loginLoading}
                  className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  {loginLoading ? 'Cargando...' : 'Iniciar Sesión'}
                </button>
              </div>
              
              <div className="text-center text-sm text-gray-500">
                ¿No tienes cuenta? Regístrate en el checkout al hacer tu primer pedido.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
