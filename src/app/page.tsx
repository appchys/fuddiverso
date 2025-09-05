'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { getAllBusinesses, searchBusinesses } from '@/lib/database'
import { Business } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { useSearchParams } from 'next/navigation'

function HomePageContent() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [followedBusinesses, setFollowedBusinesses] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<string[]>(['all'])

  useEffect(() => {
    // Leer parámetros de búsqueda de la URL
    const urlSearch = searchParams.get('search') || ''
    const urlCategory = searchParams.get('category') || 'all'
    
    setSearchTerm(urlSearch)
    setSelectedCategory(urlCategory)
    
    // Cargar negocios con los parámetros de la URL
    loadBusinessesWithParams(urlSearch, urlCategory)
    
    // Cargar restaurantes seguidos del usuario
    if (user) {
      loadFollowedBusinesses()
    }
  }, [searchParams, user])

  const loadBusinessesWithParams = async (search: string, category: string) => {
    try {
      setLoading(true)
      const data = search || category !== 'all' 
        ? await searchBusinesses(search, category)
        : await getAllBusinesses()
      
      setBusinesses(data)
      
      // Extraer categorías únicas de los negocios
      const allBusinesses = await getAllBusinesses()
      const uniqueCategories = new Set<string>()
      allBusinesses.forEach(business => {
        if (business.categories && business.categories.length > 0) {
          business.categories.forEach(category => {
            uniqueCategories.add(category)
          })
        }
      })
      setCategories(['all', ...Array.from(uniqueCategories).sort()])
    } catch (error) {
      console.error('Error loading businesses:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCategoryChange = async (category: string) => {
    setSelectedCategory(category)
    window.history.pushState({}, '', category === 'all' ? '/' : `/?category=${category}`)
    await loadBusinessesWithParams(searchTerm, category)
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

  const getCategoryColor = (index: number) => {
    const colors = [
      '#a4d2b3', // Verde suave
      '#fee369', // Amarillo
      '#f9cccb', // Rosa suave
      '#d8dce0'  // Gris azulado
    ]
    return colors[index % colors.length]
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Quick Categories - Rappi Style */}
      <section className="py-8 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">¿Qué estás buscando?</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {categories.slice(1).map((category, index) => ( // Excluir 'all' del display
              <button
                key={category}
                onClick={() => handleCategoryChange(category)}
                className={`p-4 rounded-xl hover:scale-105 transition-transform cursor-pointer text-center text-gray-800 font-medium ${selectedCategory === category ? 'ring-2 ring-orange-500' : ''}`}
                style={{ backgroundColor: getCategoryColor(index) }}
              >
                <div className="text-3xl mb-2">🍽️</div>
                <div className="text-sm font-medium">{category}</div>
              </button>
            ))}
            <button
              onClick={() => handleCategoryChange('all')}
              className={`bg-gray-100 text-gray-800 p-4 rounded-xl hover:scale-105 transition-transform cursor-pointer text-center hover:bg-gray-200 ${selectedCategory === 'all' ? 'ring-2 ring-orange-500' : ''}`}
            >
              <div className="text-3xl mb-2">🍽️</div>
              <div className="text-sm font-medium">Ver Todo</div>
            </button>
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
                onClick={() => loadBusinessesWithParams('', 'all')}
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
                        <div className="absolute top-3 right-3">
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              handleFollowToggle(business.id)
                            }}
                            className="transition-all"
                            title={followedBusinesses.has(business.id) ? 'Dejar de seguir' : 'Seguir restaurante'}
                          >
                            {followedBusinesses.has(business.id) ? (
                              <i className="bi bi-heart-fill text-xl text-red-500"></i>
                            ) : (
                              <i className="bi bi-heart text-xl text-white drop-shadow-lg"></i>
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
                <a href="https://instagram.com/fuddi.shop" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 6.618 5.367 11.986 11.988 11.986s11.987-5.368 11.987-11.986C24.014 5.367 18.635.001 12.017.001zM8.449 16.988c-1.297 0-2.448-.49-3.323-1.297C4.198 14.897 3.708 13.746 3.708 12.45s.49-2.448 1.418-3.323c.875-.807 2.026-1.297 3.323-1.297s2.448.49 3.323 1.297c.928.875 1.418 2.026 1.418 3.323s-.49 2.447-1.418 3.322c-.875.807-2.026 1.297-3.323 1.297zm7.498-9.316c-.428 0-.807-.342-.807-.77s.342-.77.77-.77.77.342.77.77-.342.77-.77.77zm0 0M12.017 7.771c-2.312 0-4.187 1.875-4.187 4.187s1.875 4.187 4.187 4.187 4.187-1.875 4.187-4.187-1.875-4.187-4.187-4.187z"/>
                  </svg>
                </a>
                <a href="https://wa.me/593984612236" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.488"/>
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

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Cargando...</p>
      </div>
    </div>}>
      <HomePageContent />
    </Suspense>
  )
}
