'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { getAllBusinesses, searchBusinesses } from '@/lib/database'
import { Business } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import StarRating from '@/components/StarRating'

export default function HomePageContent() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [followedBusinesses, setFollowedBusinesses] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<string[]>(['all'])

  // Cargar parámetros de la URL al inicio
  useEffect(() => {
    const urlSearch = searchParams.get('search') || ''
    const urlCategory = searchParams.get('category') || 'all'
    setSearchTerm(urlSearch)
    setSelectedCategory(urlCategory)
    loadBusinessesWithParams(urlSearch, urlCategory)
    if (user) loadFollowedBusinesses()
  }, [searchParams, user])

  const loadBusinessesWithParams = async (search: string, category: string) => {
    try {
      setLoading(true)
      const data = search || category !== 'all'
        ? await searchBusinesses(search, category)
        : await getAllBusinesses()
      setBusinesses(data)

      // Cargar categorías únicas
      getAllBusinesses().then((allBusinesses) => {
        const uniqueCategories = new Set<string>()
        allBusinesses.forEach(b => b.categories?.forEach(c => uniqueCategories.add(c)))
        setCategories(['all', ...Array.from(uniqueCategories).sort()])
      }).catch(() => {})
    } finally {
      setLoading(false)
    }
  }

  const handleCategoryChange = async (category: string) => {
    setSelectedCategory(category)
    const newUrl = category === 'all' ? '/' : `/?category=${category}`
    router.push(newUrl)
    await loadBusinessesWithParams(searchTerm, category)
  }

  const loadFollowedBusinesses = () => {
    if (typeof window !== 'undefined' && user) {
      const saved = localStorage.getItem(`followedBusinesses_${user.id}`)
      if (saved) setFollowedBusinesses(new Set(JSON.parse(saved)))
    }
  }

  const handleFollowToggle = (id: string) => {
    if (!user) {
      alert('Inicia sesión para seguir restaurantes')
      return
    }
    const updated = new Set(followedBusinesses)
    updated.has(id) ? updated.delete(id) : updated.add(id)
    setFollowedBusinesses(updated)
    localStorage.setItem(`followedBusinesses_${user.id}`, JSON.stringify(Array.from(updated)))
  }

  const getCategoryColor = (index: number) => {
    const colors = ['#fef2f2', '#fde8e8', '#fee2e2', '#fff5f5']
    return colors[index % colors.length]
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* CATEGORÍAS */}
      <section className="py-10 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6 text-center">Explora por categoría</h2>
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
            {categories.slice(1).map((cat, i) => (
              <button
                key={cat}
                onClick={() => handleCategoryChange(cat)}
                className={`flex-shrink-0 w-28 h-28 rounded-2xl flex flex-col items-center justify-center shadow-sm transition-all ${
                  selectedCategory === cat ? 'ring-2 ring-[#aa1918]' : ''
                }`}
                style={{ backgroundColor: getCategoryColor(i) }}
              >
                <span className="text-3xl mb-1">🍽️</span>
                <span className="text-sm font-medium text-gray-700 truncate">{cat}</span>
              </button>
            ))}
            <button
              onClick={() => handleCategoryChange('all')}
              className={`flex-shrink-0 w-28 h-28 rounded-2xl flex flex-col items-center justify-center shadow-sm bg-gray-100 ${
                selectedCategory === 'all' ? 'ring-2 ring-[#aa1918]' : ''
              }`}
            >
              <span className="text-3xl mb-1">🍽️</span>
              <span className="text-sm font-medium text-gray-700">Todo</span>
            </button>
          </div>
        </div>
      </section>

      {/* LISTA DE RESTAURANTES */}
      <section className="py-12 bg-gray-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Restaurantes cerca de ti</h2>
            <span className="text-sm text-gray-500">{businesses.length} encontrados</span>
          </div>

          {loading ? (
            <div className="text-center py-16">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#aa1918] mx-auto"></div>
              <p className="mt-4 text-gray-600">Cargando restaurantes...</p>
            </div>
          ) : businesses.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">🍽️</div>
              <p className="text-gray-600 text-lg mb-4">No se encontraron restaurantes</p>
              <button
                onClick={() => loadBusinessesWithParams('', 'all')}
                className="bg-[#aa1918] text-white px-6 py-2 rounded-lg hover:bg-[#911515]"
              >
                Recargar
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {businesses.map((b) => {
                const link = b.username ? `/${b.username}` : `/restaurant/${b.id}`
                const followed = followedBusinesses.has(b.id)
                return (
                  <Link
                    href={link}
                    key={b.id}
                    className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden border border-gray-100"
                  >
                    <div className="relative">
                      <img
                        src={b.image || '/default.jpg'}
                        alt={b.name}
                        className="w-full h-40 object-cover"
                      />
                      <button
                        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                          e.preventDefault()
                          handleFollowToggle(b.id)
                        }}
                        className="absolute top-3 right-3"
                      >
                        {followed ? (
                          <i className="bi bi-heart-fill text-xl text-[#aa1918]"></i>
                        ) : (
                          <i className="bi bi-heart text-xl text-white drop-shadow-md"></i>
                        )}
                      </button>
                    </div>
                    <div className="p-4">
                      <h3 className="text-lg font-semibold text-gray-900 line-clamp-1">{b.name}</h3>
                      {b.categories && b.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1 my-2">
                          {b.categories.slice(0, 3).map((cat, i) => (
                            <span 
                              key={i} 
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800"
                            >
                              {cat}
                            </span>
                          ))}
                          {b.categories.length > 3 && (
                            <span className="text-xs text-gray-500">+{b.categories.length - 3} más</span>
                          )}
                        </div>
                      )}
                      <div className="mb-2">
                        {b.ratingAverage ? (
                          <div className="flex items-center">
                            <StarRating rating={b.ratingAverage} size="sm" />
                            <span className="text-xs text-gray-500 ml-1">({b.ratingCount || 0})</span>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400">Sin calificaciones</div>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-2 mb-3">{b.description}</p>
                      <div className="text-xs text-gray-500 flex justify-between items-center">
                        <span className="truncate max-w-[70%]">{b.address}</span>
                        <span className="text-[#aa1918] font-medium whitespace-nowrap ml-2">Envío $1</span>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-[#aa1918] to-[#c72524] text-white py-16">
        <div className="max-w-4xl mx-auto text-center px-6">
          <h2 className="text-3xl font-bold mb-4">¿Eres dueño de un restaurante?</h2>
          <p className="text-lg mb-8 text-red-100">
            Únete a cientos de negocios que ya crecen con Fuddi.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link href="/business/register" className="bg-white text-[#aa1918] px-6 py-3 rounded-full font-semibold hover:bg-gray-100 transition">
              Registra tu negocio
            </Link>
            <Link href="/info" className="border-2 border-white px-6 py-3 rounded-full font-semibold hover:bg-white hover:text-[#aa1918] transition">
              Saber más
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-gray-900 text-gray-400 py-10">
        <div className="max-w-6xl mx-auto px-6 text-center space-y-4">
          <Link href="/" className="text-2xl font-bold text-[#aa1918]">Fuddi</Link>
          <p className="max-w-xl mx-auto text-sm">La plataforma de delivery #1 en Ecuador. Conectamos restaurantes con clientes hambrientos.</p>
          <div className="flex justify-center gap-4 text-gray-500">
            <a href="https://instagram.com/fuddi.shop" target="_blank" rel="noopener noreferrer"><i className="bi bi-instagram text-lg hover:text-white"></i></a>
            <a href="https://wa.me/593984612236" target="_blank" rel="noopener noreferrer"><i className="bi bi-whatsapp text-lg hover:text-white"></i></a>
          </div>
          <p className="text-xs text-gray-500 pt-4 border-t border-gray-800">© 2025 Fuddi. Todos los derechos reservados.</p>
        </div>
      </footer>
    </div>
  )
}
