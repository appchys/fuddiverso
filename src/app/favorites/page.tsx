'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Business } from '@/types'
import { getAllBusinesses } from '@/lib/database'
import { useAuth } from '@/contexts/AuthContext'
import { isStoreOpen } from '@/lib/store-utils'
import ClientLoginModal from '@/components/ClientLoginModal'

export default function FavoritesPage() {
  const router = useRouter()
  const { user, isAuthenticated } = useAuth()
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [showLoginModal, setShowLoginModal] = useState(false)

  useEffect(() => {
    // Si no está autenticado, esperamos un poco (AuthContext puede estar inicializando)
    if (isAuthenticated === false) {
      setShowLoginModal(true)
      setLoading(false)
      return
    }

    if (user) {
      loadFavorites()
    }
  }, [user, isAuthenticated])

  const loadFavorites = async () => {
    try {
      setLoading(true)
      const saved = localStorage.getItem(`followedBusinesses_${user?.id}`)
      const favIds = saved ? new Set(JSON.parse(saved)) : new Set()

      if (favIds.size === 0) {
        setBusinesses([])
        setLoading(false)
        return
      }

      const data = await getAllBusinesses()
      const visibleBusinesses = data.filter(b => !b.isHidden && favIds.has(b.id))
      setBusinesses(visibleBusinesses)
    } catch (err) {
      console.error('Error loading favorites:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleLoginSuccess = () => {
    setShowLoginModal(false)
  }

  const handleUnfollow = (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!user) return
    
    // Remove from local storage
    const saved = localStorage.getItem(`followedBusinesses_${user.id}`)
    const favIds = saved ? new Set<string>(JSON.parse(saved)) : new Set<string>()
    favIds.delete(id)
    localStorage.setItem(`followedBusinesses_${user.id}`, JSON.stringify(Array.from(favIds)))
    
    // Update state
    setBusinesses(prev => prev.filter(b => b.id !== id))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center pb-24">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#aa1918] mb-4"></div>
        <p className="text-gray-500 font-medium">Cargando favoritos...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-white border-b sticky top-0 md:static z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <i className="bi bi-heart-fill text-[#aa1918]"></i> Mis Favoritos
          </h1>
          <span className="bg-red-50 text-[#aa1918] text-xs font-bold px-3 py-1 rounded-full">
            {businesses.length}
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {businesses.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center flex flex-col items-center">
            <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-4">
              <i className="bi bi-heart text-4xl text-gray-300"></i>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">No tienes favoritos aún</h2>
            <p className="text-gray-500 mb-6 max-w-sm">
              Sigue a tus restaurantes preferidos para verlos aquí y pedir más rápido.
            </p>
            <Link 
              href="/"
              className="bg-[#aa1918] text-white px-6 py-3 rounded-full font-bold shadow-md hover:bg-black transition-all hover:-translate-y-1"
            >
              Explorar restaurantes
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {businesses.map((business) => {
              const isOpen = isStoreOpen(business)
              
              return (
                <Link
                  key={business.id}
                  href={`/${business.username}`}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-lg transition-all duration-300 group block relative"
                >
                  <div className="h-48 relative overflow-hidden bg-gray-100">
                    <img
                      src={business.coverImage || '/default-cover.svg'}
                      alt={business.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
                    
                    <button 
                      onClick={(e) => handleUnfollow(business.id, e)}
                      className="absolute top-3 right-3 w-8 h-8 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center text-[#aa1918] hover:bg-white transition-colors shadow-sm"
                    >
                      <i className="bi bi-heart-fill"></i>
                    </button>

                    <div className="absolute bottom-3 left-3 right-3 flex items-end">
                      <div className="w-14 h-14 rounded-full border-2 border-white overflow-hidden bg-white shadow-md flex-shrink-0">
                        <img
                          src={business.image || '/default-restaurant-og.svg'}
                          alt={business.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold text-gray-900 group-hover:text-[#aa1918] transition-colors truncate pr-2">
                        {business.name}
                      </h3>
                    </div>
                    
                    <p className="text-sm text-gray-500 line-clamp-2 mb-3 h-10">
                      {business.description || 'Sin descripción'}
                    </p>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                        isOpen 
                          ? 'bg-green-100 text-green-700 border border-green-200' 
                          : 'bg-gray-100 text-gray-600 border border-gray-200'
                      }`}>
                        {isOpen ? 'Abierto' : 'Cerrado'}
                      </span>
                      
                      {business.categories && business.categories[0] && (
                        <span className="bg-gray-50 text-gray-600 text-xs px-2.5 py-1 rounded-lg font-medium border border-gray-100">
                          {business.categories[0]}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      <ClientLoginModal
        isOpen={showLoginModal}
        onClose={() => router.push('/')}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  )
}
