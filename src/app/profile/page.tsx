'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { updateClient, searchClientByPhone } from '@/lib/database'
import { validateEcuadorianPhone } from '@/lib/validation'

export default function ProfilePage() {
  const { user, isAuthenticated, login } = useAuth()
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  const [formData, setFormData] = useState({
    nombres: '',
    celular: '',
    email: ''
  })

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/')
      return
    }

    if (user) {
      setFormData({
        nombres: user.nombres || '',
        celular: user.celular || '',
        email: user.email || ''
      })
    }
  }, [user, isAuthenticated, router])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSave = async () => {
    if (!user?.id) return

    // Validaciones
    if (!formData.nombres.trim()) {
      setMessage({ type: 'error', text: 'El nombre es requerido' })
      return
    }

    if (!validateEcuadorianPhone(formData.celular)) {
      setMessage({ type: 'error', text: 'El número de celular debe tener el formato 09XXXXXXXX' })
      return
    }

    // Verificar si el celular cambió y si ya existe
    if (formData.celular !== user.celular) {
      const existingClient = await searchClientByPhone(formData.celular)
      if (existingClient && existingClient.id !== user.id) {
        setMessage({ type: 'error', text: 'Este número de celular ya está registrado por otro usuario' })
        return
      }
    }

    setLoading(true)
    try {
      await updateClient(user.id, {
        nombres: formData.nombres.trim(),
        celular: formData.celular,
        email: formData.email.trim()
      })

      // Actualizar el contexto de auth
      const updatedUser = {
        ...user,
        nombres: formData.nombres.trim(),
        celular: formData.celular,
        email: formData.email.trim()
      }
      login(updatedUser)

      setMessage({ type: 'success', text: 'Perfil actualizado correctamente' })
      setIsEditing(false)
    } catch (error) {
      console.error('Error updating profile:', error)
      setMessage({ type: 'error', text: 'Error al actualizar el perfil. Inténtalo de nuevo.' })
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    setFormData({
      nombres: user?.nombres || '',
      celular: user?.celular || '',
      email: user?.email || ''
    })
    setIsEditing(false)
    setMessage(null)
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Verificando acceso...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Mi Perfil</h1>
          <p className="mt-2 text-gray-600">Gestiona tu información personal</p>
        </div>

        {/* Mensaje de estado */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            <div className="flex items-center">
              <i className={`bi ${message.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-triangle'} mr-2`}></i>
              {message.text}
            </div>
          </div>
        )}

        {/* Información del perfil */}
        <div className="bg-white shadow-sm rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">Información Personal</h2>
              {!isEditing && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-red-600 hover:text-red-700 font-medium text-sm flex items-center"
                >
                  <i className="bi bi-pencil mr-1"></i>
                  Editar
                </button>
              )}
            </div>
          </div>

          <div className="p-6">
            <div className="space-y-6">
              {/* Avatar */}
              <div className="flex items-center space-x-4">
                <div className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                  {user.nombres?.charAt(0)?.toUpperCase() || 'U'}
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{user.nombres}</h3>
                  <p className="text-gray-500">Cliente de fuddi.shop</p>
                </div>
              </div>

              {/* Formulario */}
              <div className="grid grid-cols-1 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre completo
                  </label>
                  {isEditing ? (
                    <input
                      type="text"
                      name="nombres"
                      value={formData.nombres}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      placeholder="Tu nombre completo"
                    />
                  ) : (
                    <p className="text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">{user.nombres}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Número de celular
                  </label>
                  {isEditing ? (
                    <input
                      type="tel"
                      name="celular"
                      value={formData.celular}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      placeholder="09XXXXXXXX"
                      maxLength={10}
                    />
                  ) : (
                    <p className="text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">{user.celular}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">Este número se usa para el inicio de sesión</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email (opcional)
                  </label>
                  {isEditing ? (
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      placeholder="tu@email.com"
                    />
                  ) : (
                    <p className="text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">
                      {user.email || 'No especificado'}
                    </p>
                  )}
                </div>
              </div>

              {/* Botones de acción */}
              {isEditing && (
                <div className="flex space-x-4 pt-4 border-t">
                  <button
                    onClick={handleSave}
                    disabled={loading}
                    className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center"
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Guardando...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check mr-2"></i>
                        Guardar Cambios
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={loading}
                    className="flex-1 bg-gray-200 text-gray-800 py-2 px-4 rounded-lg hover:bg-gray-300 disabled:opacity-50 flex items-center justify-center"
                  >
                    <i className="bi bi-x mr-2"></i>
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Información adicional */}
        <div className="mt-8 bg-white shadow-sm rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Información de la cuenta</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Miembro desde:</span>
              <span className="text-gray-900">
                {user.createdAt ? new Date(user.createdAt).toLocaleDateString('es-ES') : 'No disponible'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Última actualización:</span>
              <span className="text-gray-900">
                {user.updatedAt ? new Date(user.updatedAt).toLocaleDateString('es-ES') : 'No disponible'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">ID de cliente:</span>
              <span className="text-gray-900 font-mono text-xs">{user.id}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
