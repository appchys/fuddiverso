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
        
        <div className="space-y-3">
          {qrCodes.map((qrCode, index) => {
            const isScanned = progress?.scannedCodes.includes(qrCode.id)
            
            return (
              <div
                key={qrCode.id}
                className={`flex items-center justify-between p-4 rounded-lg border-2 transition-all ${
                  isScanned
                    ? 'bg-green-50 border-green-500'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-center space-x-4">
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center ${
                      isScanned
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-300 text-gray-600'
                    }`}
                  >
                    {isScanned ? (
                      <i className="bi bi-check-lg text-2xl"></i>
                    ) : (
                      <span className="font-bold">{index + 1}</span>
                    )}
                  </div>
                  
                  <div>
                    <h4 className="font-semibold text-gray-800">{qrCode.name}</h4>
                    <p className="text-sm text-gray-600">
                      {qrCode.points} puntos
                    </p>
                  </div>
                </div>
                
                {isScanned && (
                  <i className="bi bi-check-circle-fill text-2xl text-green-500"></i>
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
