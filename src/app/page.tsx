'use client'

import React, { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { getAllBusinesses, searchBusinesses, getProductsByBusiness, getGlobalProducts } from '@/lib/database'
import { Business, Product } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import StarRating from '@/components/StarRating'

export default function HomePage() {
  return (
    <Suspense fallback={<HomePageLoading />}>
      <HomePageContent />
    </Suspense>
  )
}

function HomePageLoading() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#aa1918] mx-auto"></div>
        <p className="mt-4 text-gray-600">Cargando...</p>
      </div>
    </div>
  )
}

function HomePageContent() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [followedBusinesses, setFollowedBusinesses] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<string[]>(['all'])
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [randomProducts, setRandomProducts] = useState<Product[]>([])
  const [supplierProducts, setSupplierProducts] = useState<Record<string, Product[]>>({})

  // Cargar productos de proveedores de forma paralela y eficiente
  useEffect(() => {
    const fetchSupplierProducts = async () => {
      const suppliers = businesses.filter(b => b.businessType === 'distributor')
      if (suppliers.length === 0) return

      try {
        const productsMap: Record<string, Product[]> = {}
        // Ejecutamos en paralelo para máxima velocidad
        await Promise.all(suppliers.map(async (supplier) => {
          const products = await getProductsByBusiness(supplier.id)
          productsMap[supplier.id] = products.filter(p => p.isAvailable).slice(0, 4)
        }))
        setSupplierProducts(productsMap)
      } catch (error) {
        console.error("Error loading distributor products:", error)
      }
    }

    if (businesses.length > 0) {
      fetchSupplierProducts()
    }
  }, [businesses])

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          })
        },
        (error) => {
          console.warn('Ubicación no disponible para cálculo de distancias:', error)
        },
        { enableHighAccuracy: false, timeout: 5000 }
      )
    }
  }, [])

  // Cargar categorías únicas solo una vez al inicio
  useEffect(() => {
    const init = async () => {
      try {
        const allBusinesses = await getAllBusinesses()
        const visibleBusinesses = allBusinesses.filter(b => !b.isHidden)

        // Extraer categorías
        const uniqueCategories = new Set<string>()
        visibleBusinesses.forEach(b => b.categories?.forEach(c => uniqueCategories.add(c)))
        const shuffled = Array.from(uniqueCategories).sort(() => 0.5 - Math.random())
        setCategories(['all', ...shuffled])

        // Cargar negocios iniciales (si no hay búsqueda en la URL)
        const urlSearch = searchParams.get('search') || ''
        const urlCategory = searchParams.get('category') || 'all'

        if (!urlSearch && urlCategory === 'all') {
          setBusinesses(visibleBusinesses)
          setLoading(false)
        } else {
          loadBusinessesWithParams(urlSearch, urlCategory)
        }

        if (user) loadFollowedBusinesses()
      } catch (err) {
        console.error('Error in init:', err)
        setLoading(false)
      }
    }
    init()
  }, [])

  // Sincronizar parámetros de la URL
  useEffect(() => {
    const urlSearch = searchParams.get('search') || ''
    const urlCategory = searchParams.get('category') || 'all'
    if (urlSearch !== searchTerm || urlCategory !== selectedCategory) {
      setSearchTerm(urlSearch)
      setSelectedCategory(urlCategory)
      loadBusinessesWithParams(urlSearch, urlCategory)
    }
  }, [searchParams])

  // Cargar productos aleatorios de forma EFICIENTE (una sola query)
  const loadRandomProducts = async (category: string = 'all') => {
    try {
      const selected = await getGlobalProducts(category, 24)
      setRandomProducts(selected)
    } catch (error) {
      console.error('Error loading random products:', error)
    }
  }

  useEffect(() => {
    loadRandomProducts(selectedCategory)
  }, [selectedCategory])

  const loadBusinessesWithParams = async (search: string, category: string) => {
    try {
      setLoading(true)
      const data = search || category !== 'all'
        ? await searchBusinesses(search, category)
        : await getAllBusinesses()
      // Filtrar negocios ocultos
      const visibleBusinesses = data.filter(b => !b.isHidden)
      setBusinesses(visibleBusinesses)
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


  return (
    <div className="min-h-screen bg-gray-50">

      {/* CATEGORÍAS */}
      <section className="py-6 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => handleCategoryChange('all')}
              className={`inline-flex items-center px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${selectedCategory === 'all'
                ? 'bg-[#aa1918] text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
              Todo
            </button>
            {categories.slice(1).map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategoryChange(cat)}
                className={`inline-flex items-center px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${selectedCategory === cat
                  ? 'bg-[#aa1918] text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* PRODUCTOS ALEATORIOS */}
      <section className="py-6 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="relative">
            <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 random-products-carousel">
              {randomProducts.map((product) => {
                const business = businesses.find(b => b.id === product.businessId)
                const businessLink = business?.username ? `/${business.username}` : `/restaurant/${product.businessId}`
                const productLink = `${businessLink}/${product.slug || product.id}`

                return (
                  <Link
                    key={product.id}
                    href={productLink}
                    className="flex-shrink-0 w-64 bg-white rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden border border-gray-100"
                  >
                    <div className="relative h-40 bg-gray-100 flex items-center justify-center">
                      {product.image ? (
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                          <i className="bi bi-bag text-4xl text-gray-400"></i>
                        </div>
                      )}
                      {product.price > 0 && (
                        <div className="absolute top-3 right-3 bg-[#aa1918] text-white px-2 py-1 rounded-full text-xs font-bold">
                          ${product.price}
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex gap-3 mb-2">
                        <div className="w-8 h-8 rounded-full overflow-hidden border border-gray-100 flex-shrink-0 bg-white">
                          {business?.image ? (
                            <img
                              src={business.image}
                              alt={business.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-50">
                              <i className="bi bi-shop text-gray-400"></i>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-gray-900 line-clamp-1">
                            {product.name}
                          </h3>
                          {business && (
                            <p className="text-xs text-gray-500 line-clamp-1">
                              {business.name}
                            </p>
                          )}
                        </div>
                      </div>
                      {product.description && (
                        <p className="text-xs text-gray-600 line-clamp-2">
                          {product.description}
                        </p>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>

            {/* Flechas de navegación */}
            <button
              onClick={() => {
                const container = document.querySelector('.random-products-carousel')
                if (container) {
                  container.scrollLeft -= 300
                }
              }}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-700 hover:bg-gray-50 transition-all z-10"
            >
              <i className="bi bi-chevron-left"></i>
            </button>
            <button
              onClick={() => {
                const container = document.querySelector('.random-products-carousel')
                if (container) {
                  container.scrollLeft += 300
                }
              }}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-700 hover:bg-gray-50 transition-all z-10"
            >
              <i className="bi bi-chevron-right"></i>
            </button>
          </div>
        </div>
      </section>


      {/* LISTA DE RESTAURANTES */}
      <section className="py-12 bg-gray-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex justify-between items-end mb-8">
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight">Restaurantes cerca de ti</h2>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-100 px-3 py-1 rounded-full">{businesses.filter(b => b.businessType !== 'distributor').length} locales</span>
          </div>

          {loading ? (
            <div className="text-center py-16">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#aa1918] mx-auto"></div>
              <p className="mt-4 text-gray-600">Cargando restaurantes...</p>
            </div>
          ) : businesses.filter(b => b.businessType !== 'distributor').length === 0 ? (
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
              {businesses.filter(b => b.businessType !== 'distributor').map((b) => {
                const link = b.username ? `/${b.username}` : `/restaurant/${b.id}`
                const followed = followedBusinesses.has(b.id)
                return (
                  <Link
                    href={link}
                    key={b.id}
                    className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden border border-gray-100 group"
                  >
                    <div className="relative h-40 bg-gray-100 flex items-center justify-center">
                      {b.image ? (
                        <img
                          src={b.image}
                          alt={b.name}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                        />
                      ) : (
                        <i className="bi bi-shop text-5xl text-gray-400"></i>
                      )}
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
                      <h3 className="text-sm font-bold text-gray-900 line-clamp-1 group-hover:text-[#aa1918] transition-colors">{b.name}</h3>
                      {b.categories && b.categories.length > 0 && (
                        <div className="flex gap-1 my-2 overflow-x-auto scrollbar-hide">
                          {b.categories.map((cat, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 whitespace-nowrap flex-shrink-0"
                            >
                              {cat}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mb-2">
                        {b.ratingAverage ? (
                          <div className="flex items-center">
                            <StarRating rating={b.ratingAverage} size="sm" />
                            <span className="text-xs text-gray-500 ml-1">({b.ratingCount || 0})</span>
                          </div>
                        ) : (
                          <div className="text-[10px] font-bold text-gray-300 uppercase letter tracking-widest">Sin reseñas</div>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 line-clamp-2 mb-3 leading-relaxed">{b.description}</p>
                      <div className="text-xs text-gray-500 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          {(() => {
                            const getBusinessLocation = (business: Business) => {
                              if (business.pickupSettings?.latlong) {
                                const [lat, lng] = business.pickupSettings.latlong
                                  .split(',')
                                  .map((s) => parseFloat(s.trim()))
                                if (!isNaN(lat) && !isNaN(lng)) return { lat, lng }
                              }
                              if (business.mapLocation?.lat && business.mapLocation?.lng) {
                                return business.mapLocation
                              }
                              return null
                            }

                            const businessLoc = getBusinessLocation(b)
                            if (userLocation && businessLoc) {
                              const calcDist = (
                                lat1: number,
                                lon1: number,
                                lat2: number,
                                lon2: number
                              ) => {
                                const R = 6371
                                const dLat = ((lat2 - lat1) * Math.PI) / 180
                                const dLon = ((lon2 - lon1) * Math.PI) / 180
                                const a =
                                  Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                                  Math.cos((lat1 * Math.PI) / 180) *
                                  Math.cos((lat2 * Math.PI) / 180) *
                                  Math.sin(dLon / 2) *
                                  Math.sin(dLon / 2)
                                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
                                return R * c
                              }
                              const dist = calcDist(
                                userLocation.lat,
                                userLocation.lng,
                                businessLoc.lat,
                                businessLoc.lng
                              )
                              return (
                                <span className="text-[#aa1918] font-bold whitespace-nowrap text-[10px] uppercase bg-red-50 px-3 py-1 rounded-full">
                                  {dist.toFixed(1)} km
                                </span>
                              )
                            }
                            return null
                          })()}
                          <span className="text-[#aa1918] font-bold whitespace-nowrap text-[10px] uppercase ml-2 bg-red-50 px-3 py-1 rounded-full">
                            Envío $1
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* PEQUEÑA SECCIÓN DE REGISTRO (CONVERTIDA) */}
      <section className="py-8 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6">
          <div className="bg-gradient-to-r from-red-600 to-orange-500 rounded-3xl p-6 sm:p-10 text-white shadow-xl flex flex-col sm:flex-row items-center justify-between gap-6 overflow-hidden relative group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-20 -mt-20 blur-3xl group-hover:bg-white/20 transition-all duration-500"></div>
            <div className="relative z-10 text-center sm:text-left">
              <h2 className="text-2xl sm:text-3xl font-black mb-2 tracking-tight">¿Tienes un negocio?</h2>
              <p className="text-red-50 font-medium text-sm sm:text-base opacity-90">
                Empieza hoy mismo, vende tus productos y encuentra los mejores proveedores.
              </p>
            </div>
            <div className="relative z-10 flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Link
                href="/business/register"
                className="bg-white text-red-600 px-8 py-3 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-red-50 transition-all shadow-lg active:scale-95 text-center"
              >
                Vende aquí
              </Link>
              <button
                onClick={() => {
                  const el = document.getElementById('suppliers-section');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="bg-red-700/30 backdrop-blur-md text-white border border-white/30 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-700/50 transition-all text-center"
              >
                Proveedores
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* SECCIÓN PROVEEDORES (NUEVA) */}
      {businesses.filter(b => b.businessType === 'distributor').length > 0 && (
        <section id="suppliers-section" className="py-12 bg-white border-t border-gray-100">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex justify-between items-end mb-8">
              <h2 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight">Proveedores Aliados</h2>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-100 px-3 py-1 rounded-full">{businesses.filter(b => b.businessType === 'distributor').length} aliados</span>
            </div>

            <div className="space-y-10">
              {businesses.filter(b => b.businessType === 'distributor').map((b) => {
                const link = b.username ? `/${b.username}` : `/restaurant/${b.id}`
                const products = supplierProducts[b.id] || []

                return (
                  <div key={b.id} className="group">
                    {/* Header del Proveedor */}
                    <div className="mb-4 px-2">
                      <Link href={link} className="flex items-center gap-3 hover:opacity-80 transition-all group/header">
                        <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-orange-50 bg-orange-50 shadow-sm flex-shrink-0 group-hover/header:border-orange-500 transition-colors">
                          {b.image ? <img src={b.image} alt={b.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-orange-50 text-orange-200"><i className="bi bi-shop text-xl"></i></div>}
                        </div>
                        <div>
                          <h3 className="text-lg font-black text-gray-900 uppercase tracking-tighter leading-none mb-1 group-hover/header:text-orange-600 transition-colors">{b.name}</h3>
                          {b.description && (
                            <p className="text-[10px] font-medium text-gray-500 line-clamp-1">{b.description}</p>
                          )}
                        </div>
                      </Link>
                    </div>

                    {/* Carrusel Horizontal de Productos */}
                    <div className="relative">
                      <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 px-2">
                        {products.length > 0 ? (
                          products.map((product) => (
                            <Link
                              key={product.id}
                              href={`${link}/${product.slug || product.id}`}
                              className="flex-shrink-0 w-36 sm:w-44 bg-white rounded-2xl p-3 border border-gray-100 shadow-sm hover:shadow-xl hover:scale-[1.02] transition-all duration-300 group/product"
                            >
                              <div className="aspect-square rounded-xl overflow-hidden bg-gray-50 mb-3 relative">
                                {product.image ? (
                                  <img src={product.image} alt={product.name} className="w-full h-full object-cover group-hover/product:scale-110 transition-transform duration-500" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-200 bg-gray-50">
                                    <i className="bi bi-box text-5xl"></i>
                                  </div>
                                )}
                                {product.price > 0 && (
                                  <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md text-gray-900 px-3 py-1 rounded-full text-[10px] font-black shadow-sm ring-1 ring-black/5">
                                    ${product.price}
                                  </div>
                                )}
                              </div>
                              <h4 className="text-xs font-bold text-gray-900 line-clamp-1 mb-1 group-hover/product:text-orange-600 transition-colors uppercase tracking-tight">{product.name}</h4>
                              <p className="text-[10px] text-gray-400 line-clamp-1 leading-none">{product.description || 'Sin descripción'}</p>
                            </Link>
                          ))
                        ) : (
                          [...Array(4)].map((_, i) => (
                            <div key={i} className="flex-shrink-0 w-36 sm:w-44 aspect-[4/5] bg-gray-50 rounded-2xl border border-dashed border-gray-200 flex flex-col items-center justify-center p-4 text-center">
                              <i className="bi bi-box text-3xl text-gray-200 mb-2"></i>
                              <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">Catálogo próximamente</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

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