'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQRCodesByBusiness, getUserQRProgress } from '@/lib/database'
import { QRCode, UserQRProgress } from '@/types'
import QRScanner from '@/components/QRScanner'
import ProgressTracker from '@/components/ProgressTracker'
import ClientLoginModal from '@/components/ClientLoginModal'
import { useAuth } from '@/contexts/AuthContext'
import { normalizeEcuadorianPhone } from '@/lib/validation'

export default function CollectionPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [qrCodes, setQrCodes] = useState<QRCode[]>([])
  const [progress, setProgress] = useState<UserQRProgress | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [businessId, setBusinessId] = useState<string>('')
  const [showLoginModal, setShowLoginModal] = useState(false)

  useEffect(() => {
    // Verificar si hay un usuario en el contexto primero
    if (user && user.celular) {
      const normalizedPhone = normalizeEcuadorianPhone(user.celular)
      setUserId(normalizedPhone)
      const defaultBusinessId = '0FeNtdYThoTRMPJ6qaS7' // Reemplazar con el ID real
      setBusinessId(defaultBusinessId)
      loadData(normalizedPhone, defaultBusinessId)
    } else {
      // Si no, verificar localStorage
      const storedPhone = localStorage.getItem('loginPhone')

      if (storedPhone) {
        const normalizedPhone = normalizeEcuadorianPhone(storedPhone)
        setUserId(normalizedPhone)
        const defaultBusinessId = '0FeNtdYThoTRMPJ6qaS7' // Reemplazar con el ID real
        setBusinessId(defaultBusinessId)
        loadData(normalizedPhone, defaultBusinessId)
      } else {
        setShowLoginModal(true)
        setLoading(false)
      }
    }
  }, [router, user])

  const handleLoginSuccess = (client: any) => {
    const normalizedPhone = normalizeEcuadorianPhone(client.celular)
    setUserId(normalizedPhone)
    const defaultBusinessId = '0FeNtdYThoTRMPJ6qaS7'
    setBusinessId(defaultBusinessId)
    loadData(normalizedPhone, defaultBusinessId)
  }

  const loadData = async (uid: string, bizId: string) => {
    try {
      setLoading(true)
      const [codes, userProgress] = await Promise.all([
        getQRCodesByBusiness(bizId),
        getUserQRProgress(uid, bizId)
      ])

      setQrCodes(codes)
      setProgress(userProgress)
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleScanSuccess = (newProgress: UserQRProgress) => {
    setProgress(newProgress)
    setShowScanner(false)
  }

  const handleRewardClaimed = async () => {
    if (userId && businessId) {
      await loadData(userId, businessId)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <i className="bi bi-arrow-repeat animate-spin text-4xl text-red-600 mb-4"></i>
          <p className="text-gray-600">Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <button
            onClick={() => router.back()}
            className="mb-4 flex items-center text-white hover:text-red-100 transition-colors"
          >
            <i className="bi bi-arrow-left me-2"></i>
            Volver
          </button>

          <div className="text-center">
            <i className="bi bi-collection-fill text-5xl mb-3"></i>
            <h1 className="text-3xl font-bold mb-2">Colección QR</h1>
            <p className="text-red-100">
              Escanea los 5 códigos QR y gana recompensas
            </p>
          </div>
        </div>
      </div>

      {/* Contenido principal */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {qrCodes.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <i className="bi bi-exclamation-circle text-5xl text-gray-400 mb-4"></i>
            <h3 className="text-xl font-bold text-gray-800 mb-2">
              No hay códigos QR disponibles
            </h3>
            <p className="text-gray-600">
              Aún no se han configurado códigos QR para este negocio.
            </p>
          </div>
        ) : (
          <>
            <ProgressTracker
              qrCodes={qrCodes}
              progress={progress}
              userId={userId || ''}
              onRewardClaimed={handleRewardClaimed}
            />

            {/* Botón para escanear */}
            {!progress?.completed && (
              <div className="mt-6">
                <button
                  onClick={() => setShowScanner(true)}
                  className="w-full bg-red-600 text-white py-4 rounded-lg font-bold text-lg hover:bg-red-700 transition-colors shadow-lg flex items-center justify-center"
                >
                  <i className="bi bi-qr-code-scan me-2 text-2xl"></i>
                  Escanear Código QR
                </button>
              </div>
            )}
          </>
        )}

        {/* Información adicional */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <i className="bi bi-info-circle-fill text-blue-600 text-xl me-3 mt-1"></i>
            <div>
              <h4 className="font-semibold text-blue-900 mb-1">
                ¿Cómo funciona?
              </h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Busca los códigos QR en cada orden</li>
                <li>• Escanea cada código una sola vez</li>
                <li>• Completa los 5 códigos para desbloquear tu recompensa</li>
                <li>• Reclama tu premio cuando completes la colección</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

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
