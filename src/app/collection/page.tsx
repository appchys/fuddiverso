'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQRCodesByBusiness, getUserQRProgress, getAllBusinesses } from '@/lib/database'
import { QRCode, UserQRProgress, Business } from '@/types'
import QRScanner from '@/components/QRScanner'
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
  const [showScanner, setShowScanner] = useState(false)
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

  const handleScanSuccess = (newProgress: UserQRProgress) => {
    // Actualizar el progreso del negocio correspondiente
    setCollections(prev => prev.map(item => {
      if (item.business.id === newProgress.businessId) {
        return { ...item, progress: newProgress }
      }
      return item
    }))
    setShowScanner(false)
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
      {/* Header */}
      <div className="bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.back()}
              className="flex items-center text-white hover:text-red-100 transition-colors"
            >
              <i className="bi bi-arrow-left text-xl me-2"></i>
              <span>Volver</span>
            </button>
            <h1 className="text-xl font-bold">Mis Colecciones</h1>
            <div className="w-8"></div> {/* Spacer for centering */}
          </div>
        </div>
      </div>

      {/* Contenido principal */}
      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* Banner informativo */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-8 text-center border border-gray-100">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-50 rounded-full mb-4">
            <i className="bi bi-collection-fill text-3xl text-red-600"></i>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Colecciona y Gana</h2>
          <p className="text-gray-600 max-w-lg mx-auto">
            Explora las colecciones disponibles en nuestras tiendas aliadas.
            Escanea los códigos QR en tus pedidos para completar colecciones y ganar premios exclusivos.
          </p>
        </div>

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
          <div className="space-y-8">
            {collections.map((item) => (
              <div key={item.business.id} className="bg-white rounded-xl shadow-md overflow-hidden border border-gray-100">
                {/* Cabecera del Negocio */}
                <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
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
                        {item.progress?.completed ?
                          <span className="text-green-600 font-medium flex items-center"><i className="bi bi-trophy-fill me-1"></i>Colección Completada</span> :
                          `${item.progress?.scannedCodes.length || 0} de ${item.qrCodes.length} escaneados`
                        }
                      </p>
                    </div>
                  </div>

                  {!item.progress?.completed && (
                    <button
                      onClick={() => setShowScanner(true)}
                      className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-red-700 transition shadow-sm flex items-center justify-center"
                    >
                      <i className="bi bi-qr-code-scan me-2"></i>
                      Escanear
                    </button>
                  )}
                </div>

                <div className="p-6">
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

      {/* Botón flotante para escanear (visible en móvil si hay colecciones) */}
      {collections.length > 0 && userId && (
        <div className="fixed bottom-6 right-6 lg:hidden z-20">
          <button
            onClick={() => setShowScanner(true)}
            className="bg-gray-900 text-white w-14 h-14 rounded-full shadow-xl flex items-center justify-center hover:bg-black transition-transform hover:scale-105"
            aria-label="Escanear QR"
          >
            <i className="bi bi-qr-code-scan text-2xl"></i>
          </button>
        </div>
      )}

      {/* Modal de escáner */}
      {showScanner && userId && (
        <QRScanner
          userId={userId}
          onScanSuccess={handleScanSuccess}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Modal de Login con ClientLoginModal */}
      <ClientLoginModal
        isOpen={showLoginModal}
        onClose={() => router.push('/')}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  )
}
