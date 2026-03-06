'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { onCheckoutProgressChange } from '@/lib/database'
import { formatPrice } from '@/lib/price-utils'

export default function CheckoutMonitorPage() {
  const params = useParams()
  const searchParams = useSearchParams()

  const clientId = Array.isArray(params?.clientId) ? params.clientId[0] : (params?.clientId as string)
  const businessId = searchParams.get('businessId')

  const [progressData, setProgressData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  useEffect(() => {
    console.log('🔍 Monitor Debug - clientId:', clientId)
    console.log('🔍 Monitor Debug - businessId:', businessId)

    // Solo suscribirse si tenemos ambos IDs
    if (!clientId || !businessId) {
      console.log('❌ Monitor Debug - Faltan parámetros, no se puede suscribir')
      setLoading(false)
      return
    }

    console.log('✅ Monitor Debug - Suscribiendo a checkoutProgress para:', `${clientId}_${businessId}`)

    // Suscribirse a cambios en tiempo real
    const unsubscribe = onCheckoutProgressChange(clientId, businessId, (data) => {
      console.log('📊 Monitor Debug - Datos recibidos:', data)
      setProgressData(data)
      setLastUpdate(new Date())
      setLoading(false)
    })

    // Timeout de 3 segundos para marcar como cargado incluso sin datos
    const timeoutId = setTimeout(() => {
      console.log('⏰ Monitor Debug - Timeout alcanzado, marcando como cargado')
      setLoading(false)
    }, 3000)

    return () => {
      clearTimeout(timeoutId)
      unsubscribe()
      console.log('🔌 Monitor Debug - Limpieza de suscripción')
    }
  }, [clientId, businessId])

  // Renderizar el contenido
  const renderContent = () => {
    if (!businessId) {
      return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-blue-900 mb-2">Esperando actividad...</h2>
          <p className="text-blue-800 mb-4">
            El cliente <span className="font-mono">{clientId}</span> aún no ha iniciado un checkout.
          </p>
          <p className="text-blue-700 text-sm">
            Esta página se actualizará automáticamente cuando el cliente abra un checkout. Puedes dejar esta pestaña abierta.
          </p>
        </div>
      )
    }

    if (loading) {
      return (
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-red-500"></div>
          <p className="mt-4 text-gray-600">Cargando progreso del cliente...</p>
        </div>
      )
    }

    if (!progressData) {
      return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-blue-800">No hay actividad de checkout para este cliente en este momento.</p>
        </div>
      )
    }

    // Renderizar datos del cliente
    const cartItems = progressData.cartItems || []
    const customerData = progressData.customerData || {}
    const deliveryData = progressData.deliveryData || {}
    const timingData = progressData.timingData || {}
    const paymentData = progressData.paymentData || {}
    const currentStep = progressData.currentStep || 1

    const subtotal = cartItems.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0)
    const deliveryCost = deliveryData.tarifa ? parseFloat(deliveryData.tarifa) : 0
    const total = subtotal + deliveryCost

    const stepLabels = ['Datos del Cliente', 'Entrega', 'Horario', 'Pago']

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Principal */}
        <div className="lg:col-span-2 space-y-6">
          {/* Paso Actual */}
          <div className="bg-white rounded-lg shadow p-6 border-l-4 border-red-500">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Paso Actual</h2>
            <div className="flex items-center gap-4">
              <div className="text-4xl font-bold text-red-500">{currentStep}</div>
              <div>
                <p className="text-lg font-medium text-gray-900">{stepLabels[currentStep - 1]}</p>
                <p className="text-sm text-gray-600">Progreso: {currentStep} de {stepLabels.length}</p>
              </div>
            </div>
            <div className="mt-4 bg-gray-100 rounded-full h-2">
              <div
                className="bg-red-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(currentStep / stepLabels.length) * 100}%` }}
              ></div>
            </div>
          </div>

          {/* Datos del Cliente */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">👤 Datos del Cliente</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 p-4 rounded">
                <p className="text-sm text-gray-600">Nombre</p>
                <p className="text-lg font-medium text-gray-900">{customerData.name || '—'}</p>
              </div>
              <div className="bg-blue-50 p-4 rounded">
                <p className="text-sm text-gray-600">Teléfono</p>
                <p className="text-lg font-medium text-gray-900">{customerData.phone || '—'}</p>
              </div>
            </div>
          </div>

          {/* Carrito */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">🛒 Carrito ({cartItems.length} artículos)</h3>
            {cartItems.length > 0 ? (
              <div className="space-y-3">
                {cartItems.map((item: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <div>
                      <p className="font-medium text-gray-900">{item.name}</p>
                      <p className="text-sm text-gray-600">{item.quantity}x {formatPrice(item.price)}</p>
                    </div>
                    <p className="font-semibold text-gray-900">{formatPrice(item.price * item.quantity)}</p>
                  </div>
                ))}
                <div className="pt-3 border-t border-gray-200">
                  <div className="flex justify-between text-sm mb-2">
                    <span>Subtotal:</span>
                    <span className="font-medium">{formatPrice(subtotal)}</span>
                  </div>
                  {deliveryCost > 0 && (
                    <div className="flex justify-between text-sm mb-2">
                      <span>Envío:</span>
                      <span className="font-medium">{formatPrice(deliveryCost)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-bold text-red-600">
                    <span>Total:</span>
                    <span>{formatPrice(total)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-gray-600 text-center py-8">El carrito está vacío</p>
            )}
          </div>

          {/* Entrega */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">📍 Entrega</h3>
            {deliveryData.type ? (
              <div className="space-y-3">
                <div className="bg-green-50 p-3 rounded">
                  <p className="text-sm text-gray-600">Tipo</p>
                  <p className="text-lg font-medium text-gray-900">
                    {deliveryData.type === 'pickup' ? '🏪 Retiro en tienda' : '🚚 Envío a domicilio'}
                  </p>
                </div>
                {deliveryData.type === 'delivery' && (
                  <>
                    <div className="bg-green-50 p-3 rounded">
                      <p className="text-sm text-gray-600">Dirección</p>
                      <p className="text-gray-900">{deliveryData.address || deliveryData.references || '—'}</p>
                    </div>
                    {deliveryData.tarifa && (
                      <div className="bg-green-50 p-3 rounded">
                        <p className="text-sm text-gray-600">Tarifa</p>
                        <p className="text-lg font-medium text-gray-900">{formatPrice(parseFloat(deliveryData.tarifa))}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <p className="text-gray-600">No seleccionado</p>
            )}
          </div>

          {/* Horario */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">⏰ Horario</h3>
            {timingData.type ? (
              <div className="space-y-3">
                <div className="bg-purple-50 p-3 rounded">
                  <p className="text-sm text-gray-600">Tipo</p>
                  <p className="text-lg font-medium text-gray-900">
                    {timingData.type === 'immediate' ? '⚡ Inmediato' : '📅 Programado'}
                  </p>
                </div>
                {timingData.type === 'scheduled' && (
                  <>
                    <div className="bg-purple-50 p-3 rounded">
                      <p className="text-sm text-gray-600">Fecha</p>
                      <p className="text-gray-900">{timingData.scheduledDate || '—'}</p>
                    </div>
                    <div className="bg-purple-50 p-3 rounded">
                      <p className="text-sm text-gray-600">Hora</p>
                      <p className="text-gray-900">{timingData.scheduledTime || '—'}</p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-gray-600">No seleccionado</p>
            )}
          </div>

          {/* Pago */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">💳 Pago</h3>
            {paymentData.method ? (
              <div className="space-y-3">
                <div className="bg-yellow-50 p-3 rounded">
                  <p className="text-sm text-gray-600">Método</p>
                  <p className="text-lg font-medium text-gray-900">
                    {paymentData.method === 'cash' && '💵 Efectivo'}
                    {paymentData.method === 'transfer' && '🏦 Transferencia'}
                    {paymentData.method === 'mixed' && '💳 Mixto'}
                  </p>
                </div>
                <div className="bg-yellow-50 p-3 rounded">
                  <p className="text-sm text-gray-600">Estado</p>
                  <p className="text-gray-900">{paymentData.paymentStatus || 'pendiente'}</p>
                </div>
                {paymentData.method === 'mixed' && (
                  <>
                    <div className="bg-yellow-50 p-3 rounded">
                      <p className="text-sm text-gray-600">Efectivo</p>
                      <p className="text-gray-900">{formatPrice(paymentData.cashAmount || 0)}</p>
                    </div>
                    <div className="bg-yellow-50 p-3 rounded">
                      <p className="text-sm text-gray-600">Transferencia</p>
                      <p className="text-gray-900">{formatPrice(paymentData.transferAmount || 0)}</p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-gray-600">No seleccionado</p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-1">
          {/* Resumen de Estado */}
          <div className="bg-white rounded-lg shadow p-6 sticky top-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">📋 Resumen</h3>

            <div className="space-y-3">
              {/* Cliente */}
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${customerData.phone ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                <span className="text-sm text-gray-700">Cliente</span>
              </div>

              {/* Entrega */}
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${deliveryData.type ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                <span className="text-sm text-gray-700">Entrega</span>
              </div>

              {/* Horario */}
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${timingData.type ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                <span className="text-sm text-gray-700">Horario</span>
              </div>

              {/* Pago */}
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${paymentData.method ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                <span className="text-sm text-gray-700">Pago</span>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="bg-blue-50 p-4 rounded">
                <p className="text-sm text-gray-600">Cliente ID</p>
                <p className="font-mono text-xs text-gray-900 break-all">{clientId}</p>
              </div>
            </div>

            {/* Información útil */}
            <div className="mt-6 pt-6 border-t border-gray-200 text-xs text-gray-600 space-y-2">
              <p><strong>Total a pagar:</strong> {formatPrice(total)}</p>
              <p><strong>Artículos:</strong> {cartItems.length}</p>
              {lastUpdate && (
                <p><strong>Actualizado:</strong> hace {Math.round((new Date().getTime() - lastUpdate.getTime()) / 1000)}s</p>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">📊 Monitor de Checkout</h1>
          <p className="text-gray-600">Visualización en tiempo real del progreso del cliente</p>
          {lastUpdate && (
            <p className="text-sm text-gray-500 mt-2">
              Última actualización: {lastUpdate.toLocaleTimeString('es-EC')}
            </p>
          )}
        </div>

        {renderContent()}
      </div>
    </div>
  )
}
