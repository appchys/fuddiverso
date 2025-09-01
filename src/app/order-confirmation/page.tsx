'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getOrder, getBusiness, searchClientByPhone, FirestoreClient } from '@/lib/database'
import { Order, Business } from '@/types'

export default function OrderConfirmationPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando confirmación...</p>
        </div>
      </div>
    }>
      <OrderConfirmationContent />
    </Suspense>
  )
}

function OrderConfirmationContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const orderId = searchParams.get('orderId')

  const [order, setOrder] = useState<Order | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clientFound, setClientFound] = useState<FirestoreClient | null>(null)

  // Estados para editar cliente
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<any>(null)

  useEffect(() => {
    if (!orderId) {
      setError('ID de pedido no encontrado')
      setLoading(false)
      return
    }

    loadOrderData(orderId)
  }, [orderId])

  const loadOrderData = async (orderId: string) => {
    try {
      setLoading(true)
      
      // Cargar datos reales de la orden
      const orderData = await getOrder(orderId)
      
      if (!orderData) {
        setError('Pedido no encontrado')
        setLoading(false)
        return
      }

      setOrder(orderData)
      
      // Cargar datos del negocio
      const businessData = await getBusiness(orderData.businessId)
      if (businessData) {
        setBusiness(businessData)
      }

      // Buscar cliente por teléfono para obtener información adicional
      try {
        const client = await searchClientByPhone(orderData.customer.phone)
        if (client) {
          setClientFound(client)
        }
      } catch (error) {
        console.log('Cliente no encontrado en la base de datos, usando datos de la orden')
      }

    } catch (error) {
      console.error('Error loading order data:', error)
      setError('Error al cargar los datos del pedido')
    } finally {
      setLoading(false)
    }
  }

  const openEditProfileModal = () => {
    if (clientFound && order) {
      setEditingClient({
        id: clientFound.id,
        nombres: clientFound.nombres,
        celular: order.customer.phone
      })
      setIsEditProfileModalOpen(true)
    }
  }

  const closeEditProfileModal = () => {
    setIsEditProfileModalOpen(false)
    setEditingClient(null)
  }

  const handleUpdateProfile = async () => {
    if (!editingClient || !order) return
    
    try {
      // Aquí implementarías la actualización en la base de datos
      // await updateClient(editingClient.id, editingClient)
      
      // Actualizar el estado local
      setClientFound(prev => prev ? {
        ...prev,
        nombres: editingClient.nombres
      } : null)
      
      setOrder(prev => prev ? {
        ...prev,
        customer: {
          ...prev.customer,
          name: editingClient.nombres,
          phone: editingClient.celular
        }
      } : null)
      
      closeEditProfileModal()
    } catch (error) {
      console.error('Error updating profile:', error)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando confirmación del pedido...</p>
        </div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="bg-white p-8 rounded-lg shadow-md max-w-md mx-auto">
            <div className="text-red-500 text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-gray-800 mb-4">Error</h1>
            <p className="text-gray-600 mb-6">{error || 'Pedido no encontrado'}</p>
            <Link 
              href="/"
              className="inline-block bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 transition"
            >
              Volver al Inicio
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-800">Confirmación de Pedido</h1>
            <div className="flex items-center space-x-2">
              <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
                ✓ Confirmado
              </span>
              <span className="text-gray-500 text-sm">#{order.id}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Resumen del Pedido */}
          <div className="lg:col-span-2 space-y-6">
            {/* Información del Restaurante */}
            {business && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">Restaurante</h2>
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 bg-gray-200 rounded-lg overflow-hidden">
                    {business.image ? (
                      <img
                        src={business.image}
                        alt={business.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                        <i className="bi bi-shop text-2xl text-gray-400"></i>
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">{business.name}</h3>
                    <p className="text-gray-600 text-sm">{business.address}</p>
                    <p className="text-gray-600 text-sm">{business.phone}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Items del Pedido */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Tu Pedido</h2>
              <div className="space-y-4">
                {order.items.map((item: any, index: number) => (
                  <div key={index} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-b-0">
                    <div className="flex items-center space-x-4">
                      {item.image && (
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-12 h-12 object-cover rounded-lg"
                        />
                      )}
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-800">{item.name}</h3>
                        <p className="text-gray-600 text-sm">{item.description}</p>
                        <p className="text-gray-500 text-sm">Cantidad: {item.quantity}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-800">${(item.price * item.quantity).toFixed(2)}</p>
                      <p className="text-gray-500 text-sm">${item.price.toFixed(2)} c/u</p>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="mt-6 pt-4 border-t border-gray-200">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold text-gray-800">Total</span>
                  <span className="text-2xl font-bold text-red-500">${order.total.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Información de Entrega */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Información de Entrega</h2>
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <span className="text-gray-500">Tipo:</span>
                  <span className="capitalize font-medium">
                    {order.delivery.type === 'delivery' ? 'Entrega a domicilio' : 'Recoger en tienda'}
                  </span>
                </div>
                {order.delivery.type === 'delivery' && order.delivery.references && (
                  <div className="flex items-start space-x-3">
                    <span className="text-gray-500">Referencias:</span>
                    <span className="font-medium">{order.delivery.references}</span>
                  </div>
                )}
                <div className="flex items-center space-x-3">
                  <span className="text-gray-500">Horario:</span>
                  <span className="font-medium">
                    {order.timing.type === 'immediate' ? 'Lo antes posible' : 'Programado'}
                  </span>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="text-gray-500">Pago:</span>
                  <span className="font-medium capitalize">
                    {order.payment.method === 'cash' ? 'Efectivo' : 'Transferencia'}
                  </span>
                </div>
                
                {/* Información adicional para transferencias */}
                {order.payment.method === 'transfer' && (
                  <>
                    {(order.payment as any).selectedBank && (
                      <div className="flex items-center space-x-3">
                        <span className="text-gray-500">Banco:</span>
                        <span className="font-medium capitalize">
                          {(order.payment as any).selectedBank === 'pichincha' && '🟡 Banco Pichincha'}
                          {(order.payment as any).selectedBank === 'pacifico' && '🔵 Banco Pacifico'}
                          {(order.payment as any).selectedBank === 'guayaquil' && '🩷 Banco Guayaquil'}
                          {(order.payment as any).selectedBank === 'produbanco' && '🟢 Banco Produbanco'}
                        </span>
                      </div>
                    )}
                    
                    <div className="flex items-center space-x-3">
                      <span className="text-gray-500">Estado del pago:</span>
                      <span className={`font-medium text-sm px-2 py-1 rounded-full ${
                        (order.payment as any).paymentStatus === 'pending' ? 'bg-red-100 text-red-800' :
                        (order.payment as any).paymentStatus === 'validating' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {(order.payment as any).paymentStatus === 'pending' && '🔴 Por cobrar'}
                        {(order.payment as any).paymentStatus === 'validating' && '🟡 Validando pago'}
                        {(order.payment as any).paymentStatus === 'paid' && '🟢 Pagado'}
                      </span>
                    </div>
                    
                    {(order.payment as any).receiptImageUrl && (
                      <div className="flex items-start space-x-3">
                        <span className="text-gray-500">Comprobante:</span>
                        <div className="flex flex-col space-y-2">
                          <img
                            src={(order.payment as any).receiptImageUrl}
                            alt="Comprobante de transferencia"
                            className="w-20 h-20 object-cover rounded-lg border cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => window.open((order.payment as any).receiptImageUrl, '_blank')}
                          />
                          <button
                            onClick={() => window.open((order.payment as any).receiptImageUrl, '_blank')}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                          >
                            Ver comprobante completo
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Datos del Cliente */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-800">Datos del Cliente</h2>
                {clientFound && (
                  <button
                    onClick={openEditProfileModal}
                    className="text-red-500 hover:text-red-600 text-sm font-medium flex items-center space-x-1"
                  >
                    <span>✏️</span>
                    <span>Editar</span>
                  </button>
                )}
              </div>
              
              <div className="space-y-3">
                <div>
                  <span className="text-gray-500 text-sm">Nombre:</span>
                  <p className="font-medium text-gray-800">{order.customer.name}</p>
                </div>
                <div>
                  <span className="text-gray-500 text-sm">Teléfono:</span>
                  <p className="font-medium text-gray-800">{order.customer.phone}</p>
                </div>
              </div>
            </div>

            {/* Estado del Pedido */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Estado del Pedido</h2>
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="text-gray-800">Pedido confirmado</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                  <span className="text-gray-500">En preparación</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                  <span className="text-gray-500">Listo para entrega</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                  <span className="text-gray-500">Entregado</span>
                </div>
              </div>
            </div>

            {/* Tiempo estimado */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-red-500 mb-1">30-45 min</div>
                <div className="text-sm text-red-600">Tiempo estimado de entrega</div>
              </div>
            </div>

            {/* Acciones */}
            <div className="space-y-3">
              <Link
                href="/"
                className="w-full bg-red-500 text-white py-3 rounded-lg hover:bg-red-600 transition text-center block"
              >
                Hacer otro pedido
              </Link>
              <button
                onClick={() => window.print()}
                className="w-full bg-gray-100 text-gray-700 py-3 rounded-lg hover:bg-gray-200 transition"
              >
                Imprimir recibo
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Editar Perfil */}
      {isEditProfileModalOpen && editingClient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-800">Editar Datos del Cliente</h3>
                <button
                  onClick={closeEditProfileModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre completo
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    value={editingClient.nombres}
                    onChange={(e) => setEditingClient({
                      ...editingClient,
                      nombres: e.target.value
                    })}
                    placeholder="Ingresa tu nombre completo"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Número de celular
                  </label>
                  <input
                    type="tel"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    value={editingClient.celular}
                    onChange={(e) => setEditingClient({
                      ...editingClient,
                      celular: e.target.value
                    })}
                    placeholder="09xxxxxxxx"
                  />
                </div>
              </div>
              
              <div className="flex space-x-3 mt-6">
                <button
                  onClick={closeEditProfileModal}
                  className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleUpdateProfile}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
