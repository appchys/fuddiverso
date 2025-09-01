'use client'

import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { searchClientByPhone } from '@/lib/database'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'

export default function Header() {
  const { user, login, logout } = useAuth()
  const [showDropdown, setShowDropdown] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [loginPhone, setLoginPhone] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

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
            <Link href="/" className="flex items-center">
              <h1 className="text-2xl font-bold text-orange-600">FudDiverso</h1>
            </Link>

            {/* Navigation */}
            <nav className="hidden md:flex items-center space-x-6">
              <Link href="/restaurants" className="text-gray-700 hover:text-orange-600 transition-colors">
                Restaurantes
              </Link>
              <Link href="/info" className="text-gray-700 hover:text-orange-600 transition-colors">
                Información
              </Link>
            </nav>

            {/* User Profile */}
            <div className="flex items-center space-x-4">
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
                      
                      <button
                        onClick={() => {
                          setShowDropdown(false)
                          // TODO: Agregar navegación a perfil
                          console.log('Ir a perfil')
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                      >
                        <i className="bi bi-person mr-2"></i>
                        Mi Perfil
                      </button>
                      
                      <button
                        onClick={() => {
                          setShowDropdown(false)
                          // TODO: Agregar navegación a pedidos
                          console.log('Ir a pedidos')
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                      >
                        <i className="bi bi-bag mr-2"></i>
                        Mis Pedidos
                      </button>
                      
                      <button
                        onClick={() => {
                          setShowDropdown(false)
                          // TODO: Agregar navegación a ubicaciones
                          console.log('Ir a ubicaciones')
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                      >
                        <i className="bi bi-geo-alt mr-2"></i>
                        Mis Ubicaciones
                      </button>
                      
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

        {/* Mobile Navigation */}
        <div className="md:hidden border-t bg-white">
          <nav className="flex items-center justify-around py-2">
            <Link href="/restaurants" className="flex flex-col items-center py-2 text-gray-600 hover:text-orange-600">
              <i className="bi bi-shop text-lg"></i>
              <span className="text-xs mt-1">Restaurantes</span>
            </Link>
            <Link href="/info" className="flex flex-col items-center py-2 text-gray-600 hover:text-orange-600">
              <i className="bi bi-info-circle text-lg"></i>
              <span className="text-xs mt-1">Info</span>
            </Link>
          </nav>
        </div>
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
