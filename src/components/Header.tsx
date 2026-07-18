'use client'

import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'
import { useState, useEffect, forwardRef, useImperativeHandle, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter, usePathname } from 'next/navigation'
import { searchClientByPhone, searchBusinesses, getAllBusinesses, createClient, setClientPin, updateClient, getClientNotifications, markClientNotificationAsRead } from '@/lib/database'
import { ArrowLeft, X, Bell, CircleDollarSign } from 'lucide-react'
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
        // Dispatch events for other components to update
        window.dispatchEvent(new Event('storage'))
        window.dispatchEvent(new Event('cart-updated'))
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
  const [showLoginModal, setShowLoginModal] = useState(initialShowLoginModal)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [categories, setCategories] = useState<string[]>(['all'])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [isUserSidebarOpen, setIsUserSidebarOpen] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [loadingNotifications, setLoadingNotifications] = useState(false)
  const [showNotificationsDropdown, setShowNotificationsDropdown] = useState(false)
  const [showMobileNotifications, setShowMobileNotifications] = useState(false)
  const router = useRouter()
  const pathname = usePathname() ?? ''

  // Escuchar notificaciones del cliente en tiempo real
  useEffect(() => {
    if (user?.id) {
      setLoadingNotifications(true)
      const fetchNotifications = async () => {
        const { db } = await import('@/lib/firebase')
        const { collection, query, where, onSnapshot } = await import('firebase/firestore')
        
        const ids = Array.from(new Set([user.id, user.celular].filter(Boolean))).slice(0, 10)
        
        const q = query(
          collection(db, 'clientNotifications'),
          where('userId', 'in', ids)
        )
        const unsubscribe = onSnapshot(q, (snapshot) => {
          const notifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
          notifs.sort((a: any, b: any) => {
            const tsA = a.updatedAt || a.createdAt
            const tsB = b.updatedAt || b.createdAt
            const dateA = tsA?.toDate ? tsA.toDate() : tsA ? new Date(tsA) : new Date(0)
            const dateB = tsB?.toDate ? tsB.toDate() : tsB ? new Date(tsB) : new Date(0)
            return dateB.getTime() - dateA.getTime()
          })
          setNotifications(notifs)
          setUnreadNotifications(notifs.filter((n: any) => !n.read).length)
          setLoadingNotifications(false)
        }, (error) => {
          console.error('Error on client notifications snapshot:', error)
          setLoadingNotifications(false)
        })
        return unsubscribe
      }
      
      let unsubPromise = fetchNotifications()
      return () => {
        unsubPromise.then(unsub => unsub?.())
      }
    } else {
      setNotifications([])
      setUnreadNotifications(0)
    }
  }, [user?.id, user?.celular])

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
      <header className="bg-white border-b fixed top-0 left-0 right-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center flex-shrink-0">
              <Link href="/" className="flex items-center">
                <h1 className="text-xl sm:text-2xl font-poetsen" style={{ color: '#ab1919' }}>Fuddi</h1>
              </Link>
            </div>

            {/* Barra de búsqueda - Desktop & Mobile Expanded */}
            {pathname === '/' && (
              <>
                {/* Desktop static search */}
                <div className="flex-1 max-w-2xl mx-4 hidden md:block" suppressHydrationWarning>
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

                {/* Mobile Expanded Search - Grows to the left */}
                <AnimatePresence>
                  {showMobileSearch && (
                    <motion.div
                      initial={{ width: 0, opacity: 0, x: 20 }}
                      animate={{ width: 'auto', opacity: 1, x: 0 }}
                      exit={{ width: 0, opacity: 0, x: 20 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="flex-1 flex items-center bg-gray-50 rounded-2xl border border-gray-100 p-1 gap-1 ml-4 md:hidden overflow-hidden"
                    >
                      <div className="relative flex-1 flex items-center min-w-0">
                        <input
                          autoFocus
                          type="text"
                          placeholder="Buscar..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          onKeyPress={handleKeyPress}
                          className="w-full bg-transparent pl-3 py-2 text-sm text-gray-900 focus:outline-none placeholder:text-gray-400"
                        />
                      </div>
                      
                      <div className="w-[1px] h-6 bg-gray-200 flex-shrink-0"></div>
                      
                      <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="bg-transparent px-1 py-1 text-gray-600 focus:outline-none text-[10px] font-bold uppercase tracking-tighter w-20 flex-shrink-0"
                      >
                        {categories.map(category => (
                          <option key={category} value={category}>
                            {category === 'all' ? 'TODO' : category.toUpperCase()}
                          </option>
                        ))}
                      </select>
                      
                      <button
                        onClick={() => {
                          handleSearch();
                          setShowMobileSearch(false);
                        }}
                        className="bg-[#aa1918] text-white w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                      >
                        <i className="bi bi-search text-xs"></i>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {/* User Profile */}
            <div className="flex items-center space-x-4">
              {/* Botón de búsqueda móvil */}
              {pathname === '/' && (
                <button
                  onClick={() => setShowMobileSearch(!showMobileSearch)}
                  className="md:hidden p-2 text-gray-600 hover:text-orange-600 transition-colors"
                >
                  <i className={`bi bi-${showMobileSearch ? 'x-lg' : 'search'} text-lg`}></i>
                </button>
              )}

              {/* Botón de Notificaciones */}
              {user && (
                <div className="relative">
                  <button
                    onClick={() => {
                      if (window.innerWidth >= 768) {
                        setShowNotificationsDropdown(!showNotificationsDropdown)
                      } else {
                        setShowMobileNotifications(true)
                      }
                    }}
                    className="relative p-2 text-gray-600 hover:text-[#ab1919] hover:bg-gray-100 rounded-full transition-colors flex items-center justify-center"
                    aria-label="Notificaciones"
                  >
                    <i className="bi bi-bell text-xl"></i>
                    {unreadNotifications > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center leading-none">
                        {unreadNotifications}
                      </span>
                    )}
                  </button>

                  {/* Dropdown de Notificaciones para PC (desplegado desde el botón) */}
                  {showNotificationsDropdown && (
                    <>
                    {/* Overlay invisible para cerrar al clicar fuera */}
                    <div className="hidden md:block fixed inset-0 z-40" onClick={() => setShowNotificationsDropdown(false)} />
                    <div className="hidden md:block absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 max-h-[480px] overflow-y-auto p-4 space-y-3.5">
                      <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                        <div>
                          <h3 className="font-extrabold text-sm text-gray-900">Notificaciones</h3>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                            {unreadNotifications > 0 ? `${unreadNotifications} nuevas` : 'Todo al día'}
                          </p>
                        </div>
                        {unreadNotifications > 0 && (
                          <button
                            onClick={async () => {
                              // Marcar todas como leídas
                              try {
                                const unread = notifications.filter(n => !n.read)
                                await Promise.all(unread.map(n => markClientNotificationAsRead(n.id)))
                                setNotifications(prev => prev.map(n => ({ ...n, read: true })))
                                setUnreadNotifications(0)
                              } catch (e) {
                                console.error('Error marking all as read:', e)
                              }
                            }}
                            className="text-[10px] text-red-600 font-black uppercase tracking-wider hover:text-red-700"
                          >
                            Marcar todo leído
                          </button>
                        )}
                      </div>

                      {loadingNotifications ? (
                        <div className="text-center py-4 text-xs font-bold text-gray-400">
                          Cargando...
                        </div>
                      ) : notifications.length === 0 ? (
                        <div className="text-center py-8 text-gray-400 flex flex-col items-center">
                          <i className="bi bi-bell-slash text-2xl mb-2 text-gray-300"></i>
                          <p className="text-xs font-black uppercase tracking-widest text-gray-400">Aún no tienes notificaciones</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-50 max-h-[350px] overflow-y-auto pr-1">
                          {notifications.map((notification) => (
                            <button
                              key={notification.id}
                              onClick={async () => {
                                if (notification.id && !notification.read) {
                                  await markClientNotificationAsRead(notification.id)
                                  setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, read: true } : n))
                                  setUnreadNotifications(prev => Math.max(0, prev - 1))
                                }
                                if (notification.type === 'order_tracking' && notification.orderId) {
                                  router.push(`/o/${notification.orderId}`)
                                  setShowNotificationsDropdown(false)
                                }
                              }}
                              className={`w-full py-3 px-2 text-left hover:bg-gray-50 rounded-xl transition-all flex items-start gap-2.5 mt-1 first:mt-0 ${notification.read ? 'bg-white' : 'bg-red-50/40'}`}
                            >
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${notification.type === 'referral_credit' ? 'bg-emerald-50 text-emerald-600' : notification.type === 'order_tracking' ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-500'}`}>
                                <i className={`bi ${notification.type === 'referral_credit' ? 'bi-cash-coin' : notification.type === 'order_tracking' ? 'bi-box-seam' : 'bi-bell'} text-sm`}></i>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-1.5">
                                  <p className="text-xs font-black text-gray-900 leading-snug line-clamp-1">{notification.title}</p>
                                  <span className="text-[8px] font-bold text-gray-300 uppercase whitespace-nowrap">
                                    {(() => {
                                      const ts = notification.updatedAt || notification.createdAt
                                      if (!ts) return ''
                                      const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
                                      return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' })
                                    })()}
                                  </span>
                                </div>
                                <p className="text-[11px] text-gray-500 leading-tight mt-0.5 line-clamp-2">{notification.message}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    </>
                  )}
                </div>
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
                          className={`w-full h-full rounded-full bg-[#ab1919] flex items-center justify-center text-white text-xs font-black shadow-inner ${user.photoURL ? 'hidden' : 'flex'}`}
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

      </header>
      
      <UserSidebar 
        isOpen={isUserSidebarOpen} 
        onClose={() => setIsUserSidebarOpen(false)} 
      />

      {/* Sidebar de notificaciones móvil */}
      {user && (
        <ClientNotificationsSidebar
          isOpen={showMobileNotifications}
          onClose={() => setShowMobileNotifications(false)}
          notifications={notifications}
          loading={loadingNotifications}
          unreadCount={unreadNotifications}
          onNotificationClick={async (notification: any) => {
            if (notification.id && !notification.read) {
              await markClientNotificationAsRead(notification.id)
              setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, read: true } : n))
              setUnreadNotifications(prev => Math.max(0, prev - 1))
            }
            if (notification.orderId) {
              router.push(`/o/${notification.orderId}`)
            }
            setShowMobileNotifications(false)
          }}
          formatDate={(value: any) => {
            const date = value?.toDate ? value.toDate() : value ? new Date(value) : null
            if (!date) return ''
            return date.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' })
          }}
        />
      )}
    </>
  )
}

const USER_SIDEBAR_PANEL_BASE_CLASS = 'absolute left-0 top-0 h-full w-full sm:w-[420px] bg-white transform transition-transform duration-500 cubic-bezier(0.4, 0, 0.2, 1)'
const getUserSidebarPanelStateClass = (isOpen: boolean) =>
    isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-[calc(100%+3rem)] shadow-none'

function ClientNotificationsSidebar({
    isOpen,
    onClose,
    notifications,
    loading,
    unreadCount,
    onNotificationClick,
    formatDate
}: {
    isOpen: boolean
    onClose: () => void
    notifications: any[]
    loading: boolean
    unreadCount: number
    onNotificationClick: (notification: any) => void
    formatDate: (value: any) => string
}) {
    return (
        <div className={`fixed inset-0 z-[130] overflow-hidden ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            <div
                className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            <div
                className={`${USER_SIDEBAR_PANEL_BASE_CLASS} ${getUserSidebarPanelStateClass(isOpen)}`}
            >
                <div className="h-full flex flex-col overflow-y-auto scrollbar-hide bg-white">
                    <div className="sticky top-0 bg-white z-50 border-b border-gray-100">
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4 min-w-0">
                                    <button
                                        onClick={onClose}
                                        className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all"
                                        title="Volver"
                                    >
                                        <ArrowLeft size={20} />
                                    </button>
                                    <div className="min-w-0">
                                        <h2 className="text-xl font-semibold text-gray-900 leading-tight">Notificaciones</h2>
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">
                                            {unreadCount > 0 ? `${unreadCount} nuevas` : 'Todo al día'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors"
                                    title="Cerrar"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 px-6 py-6 space-y-4 overflow-y-auto">
                        {loading ? (
                            <div className="bg-white rounded-xl border border-gray-200 p-4 text-xs font-bold text-gray-400">
                                Cargando...
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
                                <div className="w-12 h-12 rounded-xl bg-gray-50 text-gray-300 flex items-center justify-center mx-auto mb-4">
                                    <Bell size={20} />
                                </div>
                                <p className="text-xs font-black uppercase tracking-widest text-gray-400">Aún no tienes notificaciones</p>
                            </div>
                        ) : (
                            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                {notifications.map((notification) => (
                                    <button
                                        key={notification.id}
                                        onClick={() => onNotificationClick(notification)}
                                        className={`w-full p-4 text-left border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-all ${notification.read ? 'bg-white' : 'bg-red-50/60'}`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${notification.type === 'referral_credit' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                                                {notification.type === 'referral_credit' ? <CircleDollarSign size={16} /> : <Bell size={16} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2">
                                                    <p className="text-sm font-black text-gray-900 leading-tight">{notification.title}</p>
                                                    <span className="text-[9px] font-bold text-gray-300 uppercase whitespace-nowrap">
                                                        {formatDate(notification.createdAt)}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 leading-snug mt-1">{notification.message}</p>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
