'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getAllBusinesses, searchBusinesses } from '@/lib/database'
import { Business } from '@/types'

export default function HomePage() {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')

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
  }, [])

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
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center py-4 gap-4">
            <div className="flex flex-col sm:flex-row items-center text-center sm:text-left">
              <Link href="/" className="text-2xl sm:text-3xl font-bold text-red-600">
                Fuddiverso
              </Link>
              <span className="sm:ml-2 text-xs sm:text-sm text-gray-600">
                Delivery de comida en Ecuador
              </span>
            </div>
            
            <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-4">
              <Link
                href="/business/register"
                className="text-gray-600 hover:text-gray-900 transition-colors text-sm sm:text-base"
              >
                Registra tu Negocio
              </Link>
              <Link
                href="/business/login"
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm sm:text-base"
              >
                Acceso Negocios
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-red-600 text-white py-8 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">
            ¡Tu comida favorita a domicilio!
          </h1>
          <p className="text-lg sm:text-xl mb-6 sm:mb-8">
            Descubre los mejores restaurantes y comida rápida en Ecuador
          </p>
          
          {/* Search Bar */}
          <div className="max-w-2xl mx-auto">
            <div className="flex flex-col gap-3 sm:gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Buscar restaurantes..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-300 text-base"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <select
                  value={selectedCategory}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="flex-1 px-4 py-3 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-300 text-base"
                >
                  {categories.map(category => (
                    <option key={category} value={category}>
                      {category === 'all' ? 'Todas las categorías' : category}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleSearch}
                  className="bg-white text-red-600 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors text-base sm:min-w-[120px]"
                >
                  Buscar
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Restaurants Grid */}
      <section className="py-8 sm:py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6 sm:mb-8">
            Restaurantes Disponibles
          </h2>

          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-16 sm:h-32 w-16 sm:w-32 border-b-2 border-red-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Cargando restaurantes...</p>
            </div>
          ) : businesses.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-600 text-lg">
                No se encontraron restaurantes
              </p>
              <button
                onClick={loadBusinesses}
                className="mt-4 bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700"
              >
                Recargar
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
              {businesses.map((business) => {
                const restaurantUrl = business.username ? `/${business.username}` : `/restaurant/${business.id}`;
                
                return (
                  <div key={business.id} className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-all duration-300 transform hover:scale-105">
                    <Link href={restaurantUrl} className="block">
                      {business.image && (
                        <div className="relative">
                          <img
                            src={business.image}
                            alt={business.name}
                            className="w-full h-40 sm:h-48 object-cover cursor-pointer"
                          />
                          <div className="absolute inset-0 bg-black opacity-0 hover:opacity-20 transition-opacity duration-300"></div>
                        </div>
                      )}
                      <div className="p-4 sm:p-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start mb-2 gap-2">
                          <h3 className="text-lg sm:text-xl font-semibold text-gray-900 cursor-pointer hover:text-red-600 transition-colors">
                            {business.name}
                          </h3>
                          <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded-full self-start sm:self-auto shrink-0">
                            {business.categories?.slice(0, 2).join(', ') || 'Sin categorías'}
                          </span>
                        </div>
                        
                        <p className="text-gray-600 mb-3 sm:mb-4 text-sm sm:text-base line-clamp-2">
                          {business.description}
                        </p>
                        
                        <div className="space-y-2 mb-4">
                          <div className="flex items-center text-xs sm:text-sm text-gray-500">
                            <svg className="h-3 w-3 sm:h-4 sm:w-4 mr-1 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                            </svg>
                            <span className="truncate">{business.address}</span>
                          </div>
                          
                          <div className="flex items-center text-xs sm:text-sm text-gray-500">
                            <svg className="h-3 w-3 sm:h-4 sm:w-4 mr-1 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                            </svg>
                            <span>{business.phone}</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                    
                    <div className="px-4 sm:px-6 pb-4 sm:pb-6">
                      <Link
                        href={restaurantUrl}
                        className="block w-full bg-red-600 text-white text-center py-2 sm:py-3 rounded-lg hover:bg-red-700 transition-colors text-sm sm:text-base font-medium"
                      >
                        Ver Menú y Ordenar
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Call to Action for Businesses */}
      <section className="bg-gray-900 text-white py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            ¿Tienes un restaurante?
          </h2>
          <p className="text-lg sm:text-xl mb-6 sm:mb-8">
            Únete a Fuddiverso y llega a más clientes
          </p>
          <Link
            href="/business/register"
            className="inline-block bg-red-600 text-white px-6 sm:px-8 py-3 rounded-lg text-base sm:text-lg font-semibold hover:bg-red-700 transition-colors"
          >
            Registra tu Negocio Gratis
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="text-center">
            <Link href="/" className="text-xl sm:text-2xl font-bold text-red-600">
              Fuddiverso
            </Link>
            <p className="mt-2 text-gray-600 text-sm sm:text-base">
              Conectando Ecuador con su comida favorita
            </p>
            <div className="mt-4 text-xs sm:text-sm text-gray-500">
              © 2024 Fuddiverso. Todos los derechos reservados.
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
