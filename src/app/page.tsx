'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getAllBusinesses, searchBusinesses } from '@/lib/database'
import { Business } from '@/types'
import { useAuth } from '@/contexts/AuthContext'

export default function HomePage() {
  const { user } = useAuth()
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [followedBusinesses, setFollowedBusinesses] = useState<Set<string>>(new Set())

  const categories = [
    'all',
    'Hamburguesas',
    'Pizza',
    'Comida Rápida',
    'Postres',
    'Bebidas',
    'Ensaladas',
    'Carnes',
    'Pasta',
    'Mariscos',
    'Comida Vegana'
  ]

  useEffect(() => {
    loadBusinesses()
    // Cargar restaurantes seguidos del usuario
    if (user) {
      loadFollowedBusinesses()
    }
  }, [user])

  const loadBusinesses = async () => {
    try {
      setLoading(true)
      const data = await getAllBusinesses()
      setBusinesses(data)
    } catch (error) {
      console.error('Error loading businesses:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadFollowedBusinesses = () => {
    // TODO: Implementar lógica para cargar restaurantes seguidos desde la base de datos
    // Por ahora usamos localStorage como ejemplo
    if (typeof window !== 'undefined' && user) {
      const saved = localStorage.getItem(`followedBusinesses_${user.id}`)
      if (saved) {
        setFollowedBusinesses(new Set(JSON.parse(saved)))
      }
    }
  }

  const handleFollowToggle = (businessId: string) => {
    if (!user) {
      // TODO: Mostrar modal de login
      alert('Inicia sesión para seguir restaurantes')
      return
    }

    const newFollowed = new Set(followedBusinesses)
    if (newFollowed.has(businessId)) {
      newFollowed.delete(businessId)
    } else {
      newFollowed.add(businessId)
    }
    
    setFollowedBusinesses(newFollowed)
    
    // Guardar en localStorage (en producción sería en la base de datos)
    if (typeof window !== 'undefined') {
      localStorage.setItem(`followedBusinesses_${user.id}`, JSON.stringify(Array.from(newFollowed)))
    }
    
    // TODO: Implementar actualización en la base de datos
  }

  const handleSearch = async () => {
    try {
      setLoading(true)
      const data = await searchBusinesses(searchTerm, selectedCategory)
      setBusinesses(data)
    } catch (error) {
      console.error('Error searching businesses:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCategoryChange = async (category: string) => {
    setSelectedCategory(category)
    try {
      setLoading(true)
      const data = await searchBusinesses(searchTerm, category)
      setBusinesses(data)
    } catch (error) {
      console.error('Error filtering by category:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Search Section - Más sutil */}
      <section className="bg-white py-6 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <div className="flex flex-col gap-3">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Buscar restaurantes o comida..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={selectedCategory}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                >
                  {categories.map(category => (
                    <option key={category} value={category}>
                      {category === 'all' ? 'Todas las categorías' : category}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleSearch}
                  className="bg-orange-500 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-orange-600 transition-colors text-sm sm:min-w-[100px]"
                >
                  Buscar
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Categories - Rappi Style */}
      <section className="py-8 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">¿Qué estás buscando?</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { name: 'Hamburguesas', emoji: '🍔', color: 'bg-yellow-100 text-yellow-800' },
              { name: 'Pizza', emoji: '🍕', color: 'bg-red-100 text-red-800' },
              { name: 'Comida Rápida', emoji: '🌭', color: 'bg-orange-100 text-orange-800' },
              { name: 'Postres', emoji: '🍰', color: 'bg-pink-100 text-pink-800' },
              { name: 'Bebidas', emoji: '🥤', color: 'bg-blue-100 text-blue-800' },
              { name: 'Ensaladas', emoji: '🥗', color: 'bg-green-100 text-green-800' }
            ].map((cat) => (
              <button
                key={cat.name}
                onClick={() => handleCategoryChange(cat.name)}
                className={`${cat.color} p-4 rounded-xl hover:scale-105 transition-transform cursor-pointer text-center`}
              >
                <div className="text-3xl mb-2">{cat.emoji}</div>
                <div className="text-sm font-medium">{cat.name}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Restaurants Grid */}
      <section className="py-8 sm:py-12 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center mb-6 sm:mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Restaurantes cerca de ti
            </h2>
            <div className="text-sm text-gray-500">
              {businesses.length} restaurantes
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-16 sm:h-32 w-16 sm:w-32 border-b-2 border-orange-500 mx-auto"></div>
              <p className="mt-4 text-gray-600">Cargando restaurantes...</p>
            </div>
          ) : businesses.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🍽️</div>
              <p className="text-gray-600 text-lg mb-4">
                No se encontraron restaurantes
              </p>
              <button
                onClick={loadBusinesses}
                className="bg-orange-500 text-white px-6 py-2 rounded-lg hover:bg-orange-600"
              >
                Recargar
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
              {businesses.map((business) => {
                const restaurantUrl = business.username ? `/${business.username}` : `/restaurant/${business.id}`;
                
                return (
                  <div key={business.id} className="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 transform hover:scale-[1.02] overflow-hidden border border-gray-100">
                    <Link href={restaurantUrl} className="block">
                      <div className="relative">
                        {business.image ? (
                          <img
                            src={business.image}
                            alt={business.name}
                            className="w-full h-40 sm:h-48 object-cover"
                          />
                        ) : (
                          <div className="w-full h-40 sm:h-48 bg-gradient-to-br from-orange-100 to-orange-200 flex items-center justify-center">
                            <span className="text-4xl">🍽️</span>
                          </div>
                        )}
                        <div className="absolute top-3 left-3">
                          <span className="bg-white/90 backdrop-blur-sm text-orange-600 text-xs font-medium px-2 py-1 rounded-full">
                            {business.categories?.slice(0, 1)[0] || 'Restaurante'}
                          </span>
                        </div>
                        <div className="absolute top-3 right-3">
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              handleFollowToggle(business.id)
                            }}
                            className={`p-2 rounded-full transition-all ${
                              followedBusinesses.has(business.id)
                                ? 'bg-orange-500 text-white'
                                : 'bg-white/90 backdrop-blur-sm text-gray-600 hover:text-orange-500'
                            }`}
                            title={followedBusinesses.has(business.id) ? 'Dejar de seguir' : 'Seguir restaurante'}
                          >
                            {followedBusinesses.has(business.id) ? (
                              <i className="bi bi-heart-fill text-sm"></i>
                            ) : (
                              <i className="bi bi-heart text-sm"></i>
                            )}
                          </button>
                        </div>
                      </div>
                      
                      <div className="p-4">
                        <div className="mb-3">
                          <div className="flex items-start justify-between mb-1">
                            <h3 className="text-lg font-bold text-gray-900 line-clamp-1 flex-1">
                              {business.name}
                            </h3>
                            {followedBusinesses.has(business.id) && (
                              <span className="ml-2 bg-orange-100 text-orange-600 text-xs font-medium px-2 py-1 rounded-full">
                                Siguiendo
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 mb-2">
                            <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                            <span className="text-sm font-medium text-gray-700">4.5</span>
                            <span className="text-sm text-gray-500">• 20-30 min</span>
                          </div>
                          <p className="text-gray-600 text-sm line-clamp-2 mb-3">
                            {business.description}
                          </p>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex items-center text-xs text-gray-500">
                            <svg className="h-3 w-3 mr-1 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                            </svg>
                            <span className="truncate">{business.address}</span>
                          </div>
                          
                          <div className="flex items-center justify-between">
                            <div className="flex items-center text-xs text-gray-500">
                              <svg className="h-3 w-3 mr-1 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                              </svg>
                              <span>{business.phone}</span>
                            </div>
                            <span className="text-xs font-medium text-green-600">Envío $1.00</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Call to Action for Businesses */}
      <section className="bg-gradient-to-r from-orange-500 to-red-500 text-white py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4">
              ¿Eres dueño de un restaurante?
            </h2>
            <p className="text-lg sm:text-xl mb-6 sm:mb-8 opacity-90">
              Únete a miles de restaurantes que ya están creciendo con fuddi.shop. 
              Llega a más clientes y aumenta tus ventas.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/business/register"
                className="inline-block bg-white text-orange-500 px-6 sm:px-8 py-3 rounded-lg text-base sm:text-lg font-semibold hover:bg-gray-100 transition-colors"
              >
                Registra tu Negocio Gratis
              </Link>
              <Link
                href="/info"
                className="inline-block border-2 border-white text-white px-6 sm:px-8 py-3 rounded-lg text-base sm:text-lg font-semibold hover:bg-white hover:text-orange-500 transition-colors"
              >
                Saber más
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="md:col-span-2">
              <Link href="/" className="text-2xl font-bold text-orange-500 mb-4 block">
                fuddi.shop
              </Link>
              <p className="text-gray-400 mb-4">
                La plataforma de delivery #1 en Ecuador. Conectamos restaurantes con clientes hambrientos en todo el país.
              </p>
              <div className="flex space-x-4">
                <a href="#" className="text-gray-400 hover:text-white">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/>
                  </svg>
                </a>
                <a href="#" className="text-gray-400 hover:text-white">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.98 8.521 8.521 0 0 1-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z"/>
                  </svg>
                </a>
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-4">Para Restaurantes</h3>
              <ul className="space-y-2 text-gray-400">
                <li><a href="/business/register" className="hover:text-white">Registrar Negocio</a></li>
                <li><a href="/business/login" className="hover:text-white">Portal de Negocios</a></li>
                <li><a href="#" className="hover:text-white">Soporte</a></li>
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-4">Ayuda</h3>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#" className="hover:text-white">Centro de Ayuda</a></li>
                <li><a href="#" className="hover:text-white">Términos y Condiciones</a></li>
                <li><a href="#" className="hover:text-white">Política de Privacidad</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center">
            <p className="text-gray-400">© 2024 fuddi.shop. Todos los derechos reservados.</p>
            {/* Acceso discreto al admin */}
            <div className="mt-2">
              <Link href="/admin" className="text-xs text-gray-600 hover:text-gray-400">
                Admin
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
