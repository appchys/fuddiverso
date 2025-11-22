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

  return (
    <div className="space-y-6">
      {/* Barra de progreso */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800">Tu Progreso</h3>
          <span className="text-2xl font-bold text-red-600">
            {scannedCount}/{totalCodes}
          </span>
        </div>

        <div className="w-full bg-gray-200 rounded-full h-4 mb-2">
          <div
            className="bg-gradient-to-r from-red-500 to-red-600 h-4 rounded-full transition-all duration-500"
            style={{ width: `${progressPercentage}%` }}
          ></div>
        </div>

        <p className="text-sm text-gray-600 text-center">
          {progress?.completed
            ? '¡Colección completada!'
            : `Te faltan ${totalCodes - scannedCount} códigos`}
        </p>
      </div>

      {/* Lista de códigos */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Códigos QR</h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {qrCodes.map((qrCode, index) => {
            const isScanned = progress?.scannedCodes.includes(qrCode.id)

            return (
              <div
                key={qrCode.id}
                className={`relative flex flex-col items-center p-4 rounded-xl border-2 transition-all ${isScanned
                    ? 'bg-white border-green-500 shadow-md'
                    : 'bg-gray-50 border-gray-200 opacity-75'
                  }`}
              >
                {/* Badge de número */}
                <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isScanned ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600'
                  }`}>
                  {index + 1}
                </div>

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
                <h4 className="font-bold text-gray-800 text-center text-sm mb-1 line-clamp-1">
                  {qrCode.name}
                </h4>
                <p className="text-xs text-gray-500 font-medium">
                  {qrCode.points} {qrCode.points === 1 ? 'punto' : 'puntos'}
                </p>

                {/* Indicador de estado */}
                {isScanned ? (
                  <div className="mt-2 flex items-center text-green-600 text-xs font-bold">
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
