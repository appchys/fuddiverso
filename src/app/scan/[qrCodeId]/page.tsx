'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { scanQRCode, getQRCodeById } from '@/lib/database'
import { QRCode } from '@/types'
import SimplePhoneLoginModal from '@/components/SimplePhoneLoginModal'
import { useAuth } from '@/contexts/AuthContext'

export default function ScanQRPage() {
  const params = useParams()
  const router = useRouter()
  const qrCodeId = params.qrCodeId as string
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [qrCode, setQrCode] = useState<QRCode | null>(null)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    loadQRCode()
  }, [qrCodeId])

  const loadQRCode = async () => {
    try {
      console.log('Loading QR code:', qrCodeId)
      setLoading(true)
      const code = await getQRCodeById(qrCodeId)
      console.log('QR code loaded:', code)
      setQrCode(code)

      if (!code) {
        console.log('QR code not found')
        setLoading(false)
        setResult({
          success: false,
          message: 'Código QR no válido'
        })
        return
      }

      if (!code.isActive) {
        console.log('QR code is not active')
        setLoading(false)
        setResult({
          success: false,
          message: 'Este código QR ya no está activo'
        })
        return
      }

      // Verificar si ya está logueado (primero en contexto, luego en localStorage)
      if (user && user.celular) {
        console.log('User from context:', user.celular)
        console.log('Calling handleScan from context user')
        setLoading(false)
        await handleScan(user.celular, code)
        console.log('handleScan completed (from context)')
      } else {
        const storedPhone = localStorage.getItem('loginPhone')
        console.log('Stored phone:', storedPhone)
        console.log('Stored phone type:', typeof storedPhone)
        console.log('Stored phone truthy?:', !!storedPhone)

        if (storedPhone) {
          console.log('Calling handleScan from stored phone')
          setLoading(false)
          await handleScan(storedPhone, code)
          console.log('handleScan completed (from localStorage)')
        } else {
          console.log('No stored phone, showing login modal')
          setLoading(false)
          setShowLoginModal(true)
        }
      }
    } catch (error) {
      console.error('Error loading QR code:', error)
      setLoading(false)
      setResult({
        success: false,
        message: 'Error al cargar el código QR'
      })
    }
  }

  const handleLoginSuccess = async (client: any) => {
    // Procesar escaneo con el teléfono del cliente
    await handleScan(client.celular, qrCode)
  }

  const handleScan = async (phone: string, code: QRCode | null = qrCode) => {
    console.log('=== handleScan called ===')
    console.log('Phone:', phone)
    console.log('QR Code:', code)

    if (!code) {
      console.log('ERROR: No QR code loaded, returning')
      return
    }

    console.log('Setting processing to true')
    setProcessing(true)

    try {
      // Usar el teléfono como userId temporal
      // En producción, deberías tener un sistema de autenticación real
      const userId = phone
      console.log('Calling scanQRCode with userId:', userId, 'qrCodeId:', qrCodeId)

      const scanResult = await scanQRCode(userId, qrCodeId)
      console.log('Scan result received:', scanResult)

      setResult(scanResult)
      console.log('Result state updated')

      if (scanResult.success) {
        console.log('Scan successful, scheduling redirect to /collection in 1.5s')
        // Redirigir a la página de colección después de mostrar el mensaje
        setTimeout(() => {
          console.log('Redirecting to /collection now')
          router.push('/collection')
        }, 1500)
      } else {
        console.log('Scan failed:', scanResult.message)
      }
    } catch (error) {
      console.error('Error scanning QR:', error)
      setResult({
        success: false,
        message: 'Error al procesar el código QR'
      })
    } finally {
      console.log('Setting processing to false')
      setProcessing(false)
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

  console.log('Render state:', { loading, showLoginModal, processing, result })

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Resultado */}
        {result && (
          <div className={`bg-white rounded-lg shadow-xl p-8 text-center ${result.success ? 'border-4 border-green-500' : 'border-4 border-red-500'
            }`}>
            <div className={`w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center ${result.success ? 'bg-green-100' : 'bg-red-100'
              }`}>
              <i className={`bi ${result.success ? 'bi-check-circle-fill text-green-600' : 'bi-x-circle-fill text-red-600'
                } text-5xl`}></i>
            </div>

            <h2 className={`text-2xl font-bold mb-2 ${result.success ? 'text-green-800' : 'text-red-800'
              }`}>
              {result.success ? '¡Éxito!' : 'Oops!'}
            </h2>

            <p className="text-gray-700 mb-6">
              {result.message}
            </p>

            {result.success ? (
              <div className="space-y-3">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-green-800">
                    Redirigiendo a tu colección...
                  </p>
                </div>
                <button
                  onClick={() => router.push('/collection')}
                  className="w-full bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition-colors"
                >
                  Ver mi colección
                </button>
              </div>
            ) : (
              result.message === 'Ya escaneaste este código anteriormente' ? (
                <button
                  onClick={() => router.push('/collection')}
                  className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Ver mi colección
                </button>
              ) : (
                <button
                  onClick={() => router.push('/')}
                  className="w-full bg-gray-600 text-white py-3 rounded-lg font-medium hover:bg-gray-700 transition-colors"
                >
                  Volver al inicio
                </button>
              )
            )}
          </div>
        )}

        {processing && !result && !showLoginModal && (
          <div className="bg-white rounded-lg shadow-xl p-8 text-center">
            <i className="bi bi-arrow-repeat animate-spin text-5xl text-red-600 mb-4"></i>
            <p className="text-gray-600">Procesando código QR...</p>
          </div>
        )}
      </div>

      {/* Modal de Login simplificado - solo teléfono */}
      <SimplePhoneLoginModal
        isOpen={showLoginModal && !result}
        onClose={() => router.push('/')}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  )
}
