'use client'

import { useState, useEffect } from 'react'
import { scanQRCode } from '@/lib/database'
import { UserQRProgress } from '@/types'

interface QRScannerProps {
  userId: string
  onScanSuccess: (progress: UserQRProgress) => void
  onClose: () => void
}

export default function QRScanner({ userId, onScanSuccess, onClose }: QRScannerProps) {
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('')
  const [manualCode, setManualCode] = useState('')

  const handleScan = async (qrCodeId: string) => {
    if (!qrCodeId || scanning) return
    
    setScanning(true)
    setMessage('Procesando...')
    setMessageType('')
    
    try {
      const result = await scanQRCode(userId, qrCodeId)
      
      if (result.success && result.progress) {
        setMessage(result.message)
        setMessageType('success')
        setTimeout(() => {
          onScanSuccess(result.progress!)
          onClose()
        }, 2000)
      } else {
        setMessage(result.message)
        setMessageType('error')
        setScanning(false)
      }
    } catch (error) {
      setMessage('Error al procesar el código QR')
      setMessageType('error')
      setScanning(false)
    }
  }

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (manualCode.trim()) {
      handleScan(manualCode.trim())
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">Escanear Código QR</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            disabled={scanning}
          >
            <i className="bi bi-x-lg text-2xl"></i>
          </button>
        </div>

        <div className="mb-6">
          <div className="bg-gray-100 rounded-lg p-8 mb-4 flex items-center justify-center">
            <i className="bi bi-qr-code-scan text-6xl text-gray-400"></i>
          </div>
          
          <p className="text-sm text-gray-600 text-center mb-4">
            Ingresa el código manualmente o escanea con tu cámara
          </p>

          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Código QR
              </label>
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Ingresa el código aquí"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                disabled={scanning}
              />
            </div>

            {message && (
              <div
                className={`p-3 rounded-lg ${
                  messageType === 'success'
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : messageType === 'error'
                    ? 'bg-red-50 text-red-800 border border-red-200'
                    : 'bg-blue-50 text-blue-800 border border-blue-200'
                }`}
              >
                <div className="flex items-center">
                  <i
                    className={`bi ${
                      messageType === 'success'
                        ? 'bi-check-circle-fill'
                        : messageType === 'error'
                        ? 'bi-exclamation-circle-fill'
                        : 'bi-info-circle-fill'
                    } me-2`}
                  ></i>
                  <span className="text-sm">{message}</span>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={scanning || !manualCode.trim()}
              className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {scanning ? (
                <span className="flex items-center justify-center">
                  <i className="bi bi-arrow-repeat animate-spin me-2"></i>
                  Procesando...
                </span>
              ) : (
                'Validar Código'
              )}
            </button>
          </form>
        </div>

        <div className="text-center text-xs text-gray-500">
          <p>Escanea los 5 códigos QR para completar tu colección</p>
        </div>
      </div>
    </div>
  )
}
