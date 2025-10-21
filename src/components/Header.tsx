'use client'

import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'
import { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { searchClientByPhone, searchBusinesses, getAllBusinesses, createClient, setClientPin, updateClient } from '@/lib/database'
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

type HeaderProps = {
  initialShowLoginModal?: boolean;
}

export default function Header({ initialShowLoginModal = false }: HeaderProps) {
  const { user, login, logout } = useAuth()
  const [showDropdown, setShowDropdown] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(initialShowLoginModal)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [loginPhone, setLoginPhone] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [registerName, setRegisterName] = useState('')
  const [registerPin, setRegisterPin] = useState('')
  const [registerPinConfirm, setRegisterPinConfirm] = useState('')
  const [registerError, setRegisterError] = useState('')
  const [registerLoading, setRegisterLoading] = useState(false)
  const [foundClient, setFoundClient] = useState<any | null>(null)
  const [phoneCheckTimeout, setPhoneCheckTimeout] = useState<any>(null)
  const [loginPin, setLoginPin] = useState('')
  const [loginPinError, setLoginPinError] = useState('')
  const [loginPinLoading, setLoginPinLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [categories, setCategories] = useState<string[]>(['all'])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [showEditFields, setShowEditFields] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  // Cargar categorías
  // Efecto para manejar el evento de apertura del modal de login
  useEffect(() => {
    const handleOpenLoginModal = (event: any) => {
      // Si el evento trae un número de teléfono, lo establecemos
      if (event.detail?.phone) {
        setLoginPhone(event.detail.phone);
        // Si también trae el nombre del cliente, lo establecemos
        if (event.detail?.name) {
          setRegisterName(event.detail.name);
        }
        // Verificar si el número ya está registrado
        checkPhone(event.detail.phone);
      }
      setShowLoginModal(true);
    };

    // @ts-ignore - El tipo CustomEvent no está correctamente tipado por defecto
    window.addEventListener('openLoginModal', handleOpenLoginModal);
    return () => {
      // @ts-ignore
      window.removeEventListener('openLoginModal', handleOpenLoginModal);
    };
  }, []);

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

  // Hash PIN using Web Crypto (SHA-256)
  async function hashPin(pin: string) {
    // Prefer Web Crypto API when disponible en contexto seguro
    try {
      if (typeof window !== 'undefined' && window.crypto?.subtle?.digest && typeof window.crypto.subtle.digest === 'function') {
        const encoder = new TextEncoder()
        const data = encoder.encode(pin)
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
      }
    } catch (e) {
      console.warn('Web Crypto not available, using fallback hash:', e)
    }

    // Fallback determinista (menos seguro) cuando crypto.subtle no está disponible
    // Esto garantiza que el hash sea consistente entre registro y login en entornos no seguros
    let h = 5381
    for (let i = 0; i < pin.length; i++) {
      h = ((h << 5) + h) + pin.charCodeAt(i)
      h = h & 0xffffffff
    }
    const hex = (h >>> 0).toString(16)
    return hex.padStart(64, '0')
  }

  const handleRegisterSubmit = async () => {
    setRegisterError('')
    if (!registerName.trim()) {
      setRegisterError('Ingresa tu nombre')
      return
    }
    if (!/^[0-9]{4,6}$/.test(registerPin)) {
      setRegisterError('El PIN debe contener entre 4 y 6 dígitos')
      return
    }
    if (registerPin !== registerPinConfirm) {
      setRegisterError('Los PIN no coinciden')
      return
    }

    setRegisterLoading(true)
    try {
        const pinHash = await hashPin(registerPin)
        const normalizedPhone = normalizeEcuadorianPhone(loginPhone)

        // If we have a foundClient (existing doc without pin), update name if provided and set its pin
        if (foundClient && foundClient.id) {
          if (registerName && registerName.trim()) {
            try {
              await updateClient(foundClient.id, { nombres: registerName.trim() })
            } catch (e) {
              console.warn('Could not update client name, continuing to set PIN', e)
            }
          }
          await setClientPin(foundClient.id, pinHash)
          // refresh client object
          const updated = await searchClientByPhone(normalizedPhone)
          if (updated) login(updated as any)
        } else {
          const newClient = await createClient({ celular: normalizedPhone, nombres: registerName, pinHash })
          login(newClient as any)
        }
      // clear form
      setLoginPhone('')
      setRegisterName('')
      setRegisterPin('')
      setRegisterPinConfirm('')
    } catch (error) {
      console.error('Error creating client from header:', error)
      setRegisterError('Error al crear la cuenta. Intenta nuevamente.')
    } finally {
      setRegisterLoading(false)
    }
  }

  // Busca cliente por teléfono (con debounce corto)
  const checkPhone = async (phoneRaw?: string) => {
    const phoneToCheck = phoneRaw || loginPhone
    if (!phoneToCheck) return
    const normalized = normalizeEcuadorianPhone(phoneToCheck)
    if (!validateEcuadorianPhone(normalized)) return

    try {
      const client = await searchClientByPhone(normalized)
      setFoundClient(client)
      // No hacemos auto-login aquí — si existe PIN pediremos al usuario que lo ingrese.
    } catch (error) {
      console.error('Error checking phone:', error)
    }
  }

  const handleLoginWithPin = async () => {
    setLoginPinError('')
    if (!foundClient) return
    if (!/^[0-9]{4,6}$/.test(loginPin)) {
      setLoginPinError('PIN inválido')
      return
    }
    setLoginPinLoading(true)
    try {
      const pinHash = await hashPin(loginPin)
      if (pinHash === foundClient.pinHash) {
        login(foundClient as any)
        setShowLoginModal(false)
        setLoginPhone('')
        setLoginPin('')
      } else {
        setLoginPinError('PIN incorrecto')
      }
    } catch (error) {
      console.error('Error validating PIN:', error)
      setLoginPinError('Error al verificar PIN')
    } finally {
      setLoginPinLoading(false)
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

    setLoginError('')
    // Ejecutar la comprobación inmediata (checkPhone maneja el login automático si aplica)
    await checkPhone(normalizedPhone)
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
                    className="flex items-center gap-2 text-gray-700 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    <i className="bi bi-shop text-orange-600"></i>
                    <span>Negocio</span>
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
          <div className="bg-[#ff6a8c] rounded-lg max-w-md w-full p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  {registerName ? (
                    <>
                      Hola, {registerName}
                      <i 
                        className="bi bi-pencil text-white/70 hover:text-white transition-colors cursor-pointer"
                        onClick={() => setShowEditFields(!showEditFields)}
                      ></i>
                    </>
                  ) : 'Iniciar Sesión'}
                </h3>
                {loginPhone && (
                  <p className="text-sm text-white/80 mt-1">
                    {loginPhone}
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowLoginModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            
            <div className="space-y-4">
              {(showEditFields || !registerName || !loginPhone) && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">
                      Nombres
                    </label>
                    <input
                      type="text"
                      value={registerName}
                      onChange={(e) => setRegisterName(e.target.value)}
                      placeholder="Tu nombre completo"
                      className="w-full px-3 py-2 border border-white/30 bg-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-white/70"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-white mb-1">
                      Celular
                    </label>
                    <input
                      type="tel"
                      value={loginPhone}
                      onChange={(e) => {
                        const v = e.target.value
                        setLoginPhone(v)
                        // debounce check
                        if (phoneCheckTimeout) clearTimeout(phoneCheckTimeout)
                        const t = setTimeout(() => checkPhone(v), 500)
                        setPhoneCheckTimeout(t)
                      }}
                      onBlur={() => checkPhone()}
                      placeholder="0998765432"
                      className="w-full px-3 py-2 border border-white/30 bg-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-white/70"
                      onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    />
                    {loginError && (
                      <p className="text-yellow-300 text-sm mt-1">{loginError}</p>
                    )}
                  </div>
                </>
              )}
              
              <div className="flex gap-3">
                {/* Removed Cancelar and Iniciar Sesión buttons as requested */}
              </div>
              
              {/* Inline registration area: si no se encontró cliente, mostrar formulario de nombre+pin; si existe sin pin, pedir crear pin */}
              <div className="mt-2">
                {/* Removed informational messages as requested */}
                {foundClient && foundClient.pinHash && (
                  <div className="text-center text-sm text-gray-700">Hola {foundClient.nombres}</div>
                )}

                {/* Si el cliente existe y tiene pinHash, mostrar entrada de PIN para autenticarse */}
                {foundClient && foundClient.pinHash && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-white mb-1">Ingresa tu PIN</label>
                      <input 
                        type="password" 
                        value={loginPin} 
                        onChange={(e) => setLoginPin(e.target.value)} 
                        maxLength={6} 
                        className="w-full px-3 py-2 border border-white/30 bg-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-white/70" 
                      />
                      {loginPinError && <p className="text-yellow-300 text-sm mt-1">{loginPinError}</p>}
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setShowLoginModal(false)} 
                        className="flex-1 px-4 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button 
                        onClick={handleLoginWithPin} 
                        disabled={loginPinLoading} 
                        className="flex-1 px-4 py-2 bg-white text-[#ff6a8c] font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-70"
                      >
                        {loginPinLoading ? 'Verificando...' : 'Iniciar sesión'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Formulario de nombre y PIN (visible si no hay client o si existe sin pin) */}
                {( !foundClient || (foundClient && !foundClient.pinHash) ) && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-white mb-1">Crea un PIN (4-6 dígitos)</label>
                      <input 
                        type="password" 
                        value={registerPin} 
                        onChange={(e) => setRegisterPin(e.target.value)} 
                        maxLength={6} 
                        className="w-full px-3 py-2 border border-white/30 bg-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-white/70" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-1">Confirmar PIN</label>
                      <input 
                        type="password" 
                        value={registerPinConfirm} 
                        onChange={(e) => setRegisterPinConfirm(e.target.value)} 
                        maxLength={6} 
                        className="w-full px-3 py-2 border border-white/30 bg-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-white/70" 
                      />
                    </div>
                    {registerError && <p className="text-yellow-300 text-sm">{registerError}</p>}
                    <div className="flex gap-3">
                      <button 
                        onClick={handleRegisterSubmit} 
                        disabled={registerLoading} 
                        className="w-full px-4 py-2 bg-white text-[#ff6a8c] font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-70"
                      >
                        {registerLoading ? 'Procesando...' : 'Registrarse'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* removed separate register modal; inline flow in login modal */}
    </>
  )
}
