'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQRCodesByBusiness, getUserQRProgress, getAllBusinesses } from '@/lib/database'
import { QRCode, UserQRProgress, Business } from '@/types'
import ProgressTracker from '@/components/ProgressTracker'
import ClientLoginModal from '@/components/ClientLoginModal'
import { useAuth } from '@/contexts/AuthContext'
import { normalizeEcuadorianPhone } from '@/lib/validation'

interface CollectionItem {
  business: Business
  qrCodes: QRCode[]
  progress: UserQRProgress | null
}

export default function CollectionPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [collections, setCollections] = useState<CollectionItem[]>([])
    const [showLoginModal, setShowLoginModal] = useState(false)

  useEffect(() => {
    // Verificar si hay un usuario en el contexto primero
    if (user && user.celular) {
      const normalizedPhone = normalizeEcuadorianPhone(user.celular)
      setUserId(normalizedPhone)
      loadAllCollections(normalizedPhone)
    } else {
      // Si no, verificar localStorage
      const storedPhone = localStorage.getItem('loginPhone')

      if (storedPhone) {
        const normalizedPhone = normalizeEcuadorianPhone(storedPhone)
        setUserId(normalizedPhone)
        loadAllCollections(normalizedPhone)
      } else {
        setShowLoginModal(true)
        setLoading(false)
      }
    }
  }, [router, user])

  const handleLoginSuccess = (client: any) => {
    const normalizedPhone = normalizeEcuadorianPhone(client.celular)
    setUserId(normalizedPhone)
    loadAllCollections(normalizedPhone)
    setShowLoginModal(false)
  }

  const loadAllCollections = async (uid: string) => {
    try {
      setLoading(true)
      const businesses = await getAllBusinesses()

      const collectionsData: CollectionItem[] = []

      // Cargar datos para cada negocio en paralelo
      await Promise.all(
        businesses.map(async (business) => {
          try {
            const qrCodes = await getQRCodesByBusiness(business.id)

            // Solo incluir negocios que tienen códigos QR configurados
            if (qrCodes.length > 0) {
              const progress = await getUserQRProgress(uid, business.id)
              collectionsData.push({
                business,
                qrCodes,
                progress
              })
            }
          } catch (err) {
            console.error(`Error loading data for business ${business.id}:`, err)
          }
        })
      )

      setCollections(collectionsData)
    } catch (error) {
      console.error('Error loading collections:', error)
    } finally {
      setLoading(false)
    }
  }

  
  const handleRewardClaimed = async (businessId: string) => {
    if (userId) {
      // Recargar solo el progreso de ese negocio
      try {
        const newProgress = await getUserQRProgress(userId, businessId)
        setCollections(prev => prev.map(item => {
          if (item.business.id === businessId) {
            return { ...item, progress: newProgress }
          }
          return item
        }))
      } catch (error) {
        console.error('Error reloading progress after claim:', error)
      }
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <i className="bi bi-arrow-repeat animate-spin text-4xl text-red-600 mb-4"></i>
          <p className="text-gray-600">Cargando colecciones...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      
      {/* Contenido principal */}
      <div className="max-w-4xl mx-auto px-4 py-6">

        
        {collections.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-10 text-center">
            <i className="bi bi-emoji-frown text-6xl text-gray-300 mb-4"></i>
            <h3 className="text-xl font-bold text-gray-800 mb-2">
              No hay colecciones disponibles
            </h3>
            <p className="text-gray-600">
              Actualmente ninguna tienda tiene colecciones activas.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {collections.map((item) => (
              <div key={item.business.id}>
                {/* Cabecera del Negocio */}
                <div className="bg-white rounded-xl shadow-sm px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center w-full sm:w-auto">
                    {item.business.image ? (
                      <img
                        src={item.business.image}
                        alt={item.business.name}
                        className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm me-3"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center me-3 text-gray-400">
                        <i className="bi bi-shop text-xl"></i>
                      </div>
                    )}
                    <div className="flex-1">
                      <h3 className="font-bold text-lg text-gray-800">{item.business.name}</h3>
                      <p className="text-xs text-gray-500">
                        {item.progress?.scannedCodes.length || 0} de {item.qrCodes.length} escaneados
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <ProgressTracker
                    qrCodes={item.qrCodes}
                    progress={item.progress}
                    userId={userId || ''}
                    onRewardClaimed={() => handleRewardClaimed(item.business.id)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      
      {/* Modal de Login con ClientLoginModal */}
      <ClientLoginModal
        isOpen={showLoginModal}
        onClose={() => router.push('/')}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  )
}
