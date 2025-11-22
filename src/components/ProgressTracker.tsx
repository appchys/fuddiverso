'use client'

import { QRCode, UserQRProgress } from '@/types'
import { claimReward } from '@/lib/database'
import { useState } from 'react'

interface ProgressTrackerProps {
  qrCodes: QRCode[]
  progress: UserQRProgress | null
  userId: string
  onRewardClaimed: () => void
}

export default function ProgressTracker({
  qrCodes,
  progress,
  userId,
  onRewardClaimed
}: ProgressTrackerProps) {
  const [claiming, setClaiming] = useState(false)
  const [claimMessage, setClaimMessage] = useState('')

  const scannedCount = progress?.scannedCodes.length || 0
  const totalCodes = 5
  const progressPercentage = (scannedCount / totalCodes) * 100

  const handleClaimReward = async () => {
    if (!progress?.businessId) return

    setClaiming(true)
    setClaimMessage('')

    try {
      const result = await claimReward(userId, progress.businessId)
      setClaimMessage(result.message)

      if (result.success) {
        setTimeout(() => {
          onRewardClaimed()
        }, 2000)
      }
    } catch (error) {
      setClaimMessage('Error al reclamar la recompensa')
    } finally {
      setClaiming(false)
    }
  }

  // Función para determinar si un color es claro u oscuro
  const isLightColor = (hexColor: string): boolean => {
    // Convertir hex a RGB
    const hex = hexColor.replace('#', '')
    const r = parseInt(hex.substr(0, 2), 16)
    const g = parseInt(hex.substr(2, 2), 16)
    const b = parseInt(hex.substr(4, 2), 16)

    // Calcular luminosidad usando la fórmula estándar
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

    return luminance > 0.5
  }

  return (
    <div className="space-y-6">

      {/* Lista de códigos */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Códigos QR</h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {qrCodes.map((qrCode, index) => {
            const isScanned = progress?.scannedCodes.includes(qrCode.id)
            const textColor = isScanned && qrCode.color && isLightColor(qrCode.color) ? 'text-gray-800' : 'text-white'

            return (
              <div
                key={qrCode.id}
                className={`relative flex flex-col items-center p-4 rounded-xl border-2 transition-all ${isScanned
                  ? 'shadow-md'
                  : 'bg-gray-50 border-gray-200 opacity-75'
                  }`}
                style={isScanned && qrCode.color ? { backgroundColor: qrCode.color, borderColor: qrCode.color } : {}}
              >
                {/* Imagen */}
                <div className={`w-24 h-24 mb-3 rounded-full overflow-hidden border-4 ${isScanned ? 'border-green-100' : 'border-gray-200'
                  }`}>
                  {qrCode.image ? (
                    <img
                      src={qrCode.image}
                      alt={qrCode.name}
                      className={`w-full h-full object-cover ${!isScanned ? 'grayscale' : ''}`}
                    />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center bg-gray-100 ${!isScanned ? 'grayscale' : ''}`}>
                      <i className="bi bi-qr-code text-3xl text-gray-400"></i>
                    </div>
                  )}
                </div>

                {/* Info */}
                <h4 className={`font-bold text-center text-sm mb-1 line-clamp-1 ${isScanned ? textColor : 'text-gray-800'}`}>
                  {qrCode.name}
                </h4>
                <p className={`text-xs font-medium ${isScanned ? textColor : 'text-gray-500'}`}>
                  {qrCode.points} {qrCode.points === 1 ? 'punto' : 'puntos'}
                </p>

                {/* Indicador de estado */}
                {isScanned ? (
                  <div className={`mt-2 flex items-center text-xs font-bold ${textColor}`}>
                    <i className="bi bi-check-circle-fill me-1"></i>
                    Conseguido
                  </div>
                ) : (
                  <div className="mt-2 flex items-center text-gray-400 text-xs font-medium">
                    <i className="bi bi-lock-fill me-1"></i>
                    Pendiente
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Botón de recompensa */}
      {progress?.completed && (
        <div className="bg-gradient-to-r from-red-500 to-red-600 rounded-lg shadow-lg p-6 text-white">
          <div className="text-center mb-4">
            <i className="bi bi-trophy-fill text-5xl mb-2"></i>
            <h3 className="text-2xl font-bold mb-2">¡Felicidades!</h3>
            <p className="text-red-100">
              Completaste la colección de códigos QR
            </p>
          </div>

          {!progress.rewardClaimed ? (
            <>
              {claimMessage && (
                <div className="bg-white bg-opacity-20 rounded-lg p-3 mb-4">
                  <p className="text-center text-sm">{claimMessage}</p>
                </div>
              )}

              <button
                onClick={handleClaimReward}
                disabled={claiming}
                className="w-full bg-white text-red-600 py-3 rounded-lg font-bold hover:bg-red-50 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
              >
                {claiming ? (
                  <span className="flex items-center justify-center">
                    <i className="bi bi-arrow-repeat animate-spin me-2"></i>
                    Reclamando...
                  </span>
                ) : (
                  <>
                    <i className="bi bi-gift-fill me-2"></i>
                    Reclamar Recompensa
                  </>
                )}
              </button>
            </>
          ) : (
            <div className="bg-white bg-opacity-20 rounded-lg p-4 text-center">
              <i className="bi bi-check-circle-fill text-3xl mb-2"></i>
              <p className="font-semibold">Recompensa reclamada</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
