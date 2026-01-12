'use client'

import { useState, useEffect, useRef } from 'react'
import { uploadImage, createDelivery, getAllDeliveries, toggleDeliveryStatus, updateDelivery, deleteDelivery } from '@/lib/database'
import { Delivery } from '@/types'

// Función para normalizar números de teléfono
const normalizePhone = (phone: string): string => {
  // Remover todos los caracteres no numéricos excepto el +
  let normalized = phone.replace(/[^\d+]/g, '');
  
  // Si empieza con +593, convertir a formato local
  if (normalized.startsWith('+593')) {
    normalized = '0' + normalized.substring(4); // +593 97 -> 097
  } else if (normalized.startsWith('593')) {
    normalized = '0' + normalized.substring(3); // 593 97 -> 097
  }
  
  return normalized;
};

export default function DeliveriesAdmin() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null)
  const [formData, setFormData] = useState({
    nombres: '',
    celular: '',
    email: '',
    estado: 'activo' as 'activo' | 'inactivo'
  })
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadDeliveries()
  }, [])

  const loadDeliveries = async () => {
    try {
      setLoading(true)
      const fetchedDeliveries = await getAllDeliveries()
      setDeliveries(fetchedDeliveries)
    } catch (error) {
      console.error('Error loading deliveries:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validar tipo de archivo
      if (!file.type.startsWith('image/')) {
        setErrors({ ...errors, image: 'Solo se permiten archivos de imagen' })
        return
      }

      // Validar tamaño (máximo 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setErrors({ ...errors, image: 'La imagen debe ser menor a 5MB' })
        return
      }

      setSelectedImage(file)
      setErrors({ ...errors, image: '' })

      // Crear preview
      const reader = new FileReader()
      reader.onload = (e) => {
        setPreviewImage(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.nombres.trim()) {
      newErrors.nombres = 'El nombre es obligatorio'
    }

    if (!formData.celular.trim()) {
      newErrors.celular = 'El celular es obligatorio'
    } else {
      const normalizedPhone = normalizePhone(formData.celular.trim());
      if (!/^09\d{8}$/.test(normalizedPhone)) {
        newErrors.celular = 'El celular debe tener 10 dígitos y empezar con 09'
      }
    }

    if (!formData.email.trim()) {
      newErrors.email = 'El email es obligatorio'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Email inválido'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) return

    try {
      setSubmitting(true)

      // Subir imagen si está seleccionada
      let fotoUrl = ''
      if (selectedImage) {
        setUploadingImage(true)
        try {
          fotoUrl = await uploadImage(selectedImage, 'deliveries')
        } catch (error) {
          console.error('Error uploading image:', error)
          setErrors({ ...errors, image: 'Error al subir la imagen' })
          return
        } finally {
          setUploadingImage(false)
        }
      }

      const deliveryData: any = {
        nombres: formData.nombres.trim(),
        celular: normalizePhone(formData.celular.trim()),
        email: formData.email.trim(),
        estado: formData.estado,
        fechaRegistro: new Date().toISOString()
      }

      // Solo agregar fotoUrl si existe
      if (fotoUrl) {
        deliveryData.fotoUrl = fotoUrl;
      }

      // Guardar en Firebase
      const deliveryId = await createDelivery(deliveryData)
      // Recargar la lista
      await loadDeliveries()

      // Limpiar formulario
      setFormData({
        nombres: '',
        celular: '',
        email: '',
        estado: 'activo'
      })
      setSelectedImage(null)
      setPreviewImage(null)
      setShowAddModal(false)
      setErrors({})

    } catch (error) {
      console.error('Error creating delivery:', error)
      setErrors({ ...errors, submit: 'Error al crear el delivery' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleDeliveryStatus = async (deliveryId: string) => {
    try {
      await toggleDeliveryStatus(deliveryId)
      // Recargar la lista para reflejar los cambios
      await loadDeliveries()
    } catch (error) {
      console.error('Error updating delivery status:', error)
    }
  }

  const handleEditDelivery = (delivery: Delivery) => {
    setEditingDelivery(delivery)
    setFormData({
      nombres: delivery.nombres,
      celular: delivery.celular,
      email: delivery.email,
      estado: delivery.estado
    })
    setPreviewImage(delivery.fotoUrl || null)
    setShowEditModal(true)
  }

  const handleUpdateDelivery = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm() || !editingDelivery) return

    try {
      setSubmitting(true)

      // Subir imagen si está seleccionada
      let fotoUrl = editingDelivery.fotoUrl || ''
      if (selectedImage) {
        setUploadingImage(true)
        try {
          fotoUrl = await uploadImage(selectedImage, 'deliveries')
        } catch (error) {
          console.error('Error uploading image:', error)
          setErrors({ ...errors, image: 'Error al subir la imagen' })
          return
        } finally {
          setUploadingImage(false)
        }
      }

      const updateData: Partial<Delivery> = {
        nombres: formData.nombres.trim(),
        celular: normalizePhone(formData.celular),
        email: formData.email.trim(),
        estado: formData.estado
      }

      // Solo incluir fotoUrl si ha cambiado
      if (selectedImage || fotoUrl !== editingDelivery.fotoUrl) {
        updateData.fotoUrl = fotoUrl || undefined
      }

      await updateDelivery(editingDelivery.id!, updateData)
      
      // Recargar la lista
      await loadDeliveries()

      // Limpiar formulario
      setFormData({
        nombres: '',
        celular: '',
        email: '',
        estado: 'activo'
      })
      setSelectedImage(null)
      setPreviewImage(null)
      setShowEditModal(false)
      setEditingDelivery(null)
      setErrors({})

    } catch (error) {
      console.error('Error updating delivery:', error)
      setErrors({ ...errors, submit: 'Error al actualizar el delivery' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteDelivery = async (delivery: Delivery) => {
    if (window.confirm(`¿Estás seguro de que quieres eliminar a ${delivery.nombres}?`)) {
      try {
        await deleteDelivery(delivery.id!)
        await loadDeliveries()
      } catch (error) {
        console.error('Error deleting delivery:', error)
        alert('Error al eliminar el delivery')
      }
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-600"></div>
          <p className="mt-4 text-gray-600">Cargando deliveries...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            <i className="bi bi-scooter me-2"></i>
            Gestión de Deliveries
          </h1>
          <p className="text-gray-600 mt-1">Administra los repartidores de la plataforma</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
        >
          <i className="bi bi-plus-circle me-2"></i>
          Agregar Delivery
        </button>
      </div>

      {/* Lista de Deliveries */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">
            Deliveries Registrados ({deliveries.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Delivery
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contacto
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fecha Registro
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {deliveries.map((delivery) => (
                <tr key={delivery.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 flex-shrink-0">
                        {delivery.fotoUrl ? (
                          <img
                            className="h-10 w-10 rounded-full object-cover"
                            src={delivery.fotoUrl}
                            alt={delivery.nombres}
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center">
                            <i className="bi bi-person text-gray-600"></i>
                          </div>
                        )}
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {delivery.nombres}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{delivery.celular}</div>
                    <div className="text-sm text-gray-500">{delivery.email}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      delivery.estado === 'activo'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {delivery.estado === 'activo' ? (
                        <>
                          <i className="bi bi-check-circle me-1"></i>
                          Activo
                        </>
                      ) : (
                        <>
                          <i className="bi bi-x-circle me-1"></i>
                          Inactivo
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(delivery.fechaRegistro).toLocaleDateString('es-ES')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleEditDelivery(delivery)}
                        className="text-blue-600 hover:text-blue-900"
                        title="Editar delivery"
                      >
                        <i className="bi bi-pencil"></i>
                      </button>
                      
                      <button
                        onClick={() => delivery.id && handleToggleDeliveryStatus(delivery.id)}
                        disabled={!delivery.id}
                        className={`${
                          delivery.estado === 'activo'
                            ? 'text-red-600 hover:text-red-900'
                            : 'text-green-600 hover:text-green-900'
                        } disabled:opacity-50`}
                        title={delivery.estado === 'activo' ? 'Desactivar' : 'Activar'}
                      >
                        {delivery.estado === 'activo' ? (
                          <i className="bi bi-pause-circle"></i>
                        ) : (
                          <i className="bi bi-play-circle"></i>
                        )}
                      </button>

                      <button
                        onClick={() => handleDeleteDelivery(delivery)}
                        className="text-red-600 hover:text-red-900"
                        title="Eliminar delivery"
                      >
                        <i className="bi bi-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              
              {deliveries.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="text-gray-500">
                      <i className="bi bi-scooter text-4xl mb-4"></i>
                      <p className="text-lg">No hay deliveries registrados</p>
                      <p className="text-sm">Comienza agregando el primer delivery</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal para Agregar Delivery */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold text-gray-900">
                  <i className="bi bi-plus-circle me-2"></i>
                  Agregar Nuevo Delivery
                </h3>
                <button
                  onClick={() => {
                    setShowAddModal(false)
                    setFormData({ nombres: '', celular: '', email: '', estado: 'activo' })
                    setSelectedImage(null)
                    setPreviewImage(null)
                    setErrors({})
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Foto de Perfil */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Foto de Perfil (Opcional)
                  </label>
                  <div className="flex items-center space-x-4">
                    <div className="h-16 w-16 flex-shrink-0">
                      {previewImage ? (
                        <img
                          src={previewImage}
                          alt="Preview"
                          className="h-16 w-16 rounded-full object-cover border-2 border-gray-300"
                        />
                      ) : (
                        <div className="h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center">
                          <i className="bi bi-person text-2xl text-gray-400"></i>
                        </div>
                      )}
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
                      >
                        <i className="bi bi-camera me-1"></i>
                        Seleccionar
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageSelect}
                        className="hidden"
                      />
                    </div>
                  </div>
                  {errors.image && (
                    <p className="text-red-500 text-xs mt-1">{errors.image}</p>
                  )}
                </div>

                {/* Nombres */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombres Completos *
                  </label>
                  <input
                    type="text"
                    value={formData.nombres}
                    onChange={(e) => setFormData({ ...formData, nombres: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 ${
                      errors.nombres ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="Juan Pérez Rodríguez"
                  />
                  {errors.nombres && (
                    <p className="text-red-500 text-xs mt-1">{errors.nombres}</p>
                  )}
                </div>

                {/* Celular */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Celular *
                  </label>
                  <input
                    type="tel"
                    value={formData.celular}
                    onChange={(e) => {
                      const normalizedValue = normalizePhone(e.target.value);
                      setFormData({ ...formData, celular: normalizedValue });
                    }}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 ${
                      errors.celular ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="0987654321 o +593 97 869 7867"
                  />
                  {errors.celular && (
                    <p className="text-red-500 text-xs mt-1">{errors.celular}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    Acepta formatos: 0987654321 o +593 97 869 7867
                  </p>
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 ${
                      errors.email ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="juan@example.com"
                  />
                  {errors.email && (
                    <p className="text-red-500 text-xs mt-1">{errors.email}</p>
                  )}
                </div>

                {/* Estado */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Estado *
                  </label>
                  <select
                    value={formData.estado}
                    onChange={(e) => setFormData({ ...formData, estado: e.target.value as 'activo' | 'inactivo' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  >
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                  </select>
                </div>

                {errors.submit && (
                  <div className="text-red-500 text-sm text-center">
                    {errors.submit}
                  </div>
                )}

                {/* Botones */}
                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddModal(false)
                      setFormData({ nombres: '', celular: '', email: '', estado: 'activo' })
                      setSelectedImage(null)
                      setPreviewImage(null)
                      setErrors({})
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || uploadingImage}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {submitting || uploadingImage ? (
                      <>
                        <i className="bi bi-arrow-clockwise animate-spin me-2"></i>
                        {uploadingImage ? 'Subiendo...' : 'Guardando...'}
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check-circle me-2"></i>
                        Crear Delivery
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal para Editar Delivery */}
      {showEditModal && editingDelivery && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold text-gray-900">
                  <i className="bi bi-pencil me-2"></i>
                  Editar Delivery
                </h3>
                <button
                  onClick={() => {
                    setShowEditModal(false)
                    setEditingDelivery(null)
                    setFormData({ nombres: '', celular: '', email: '', estado: 'activo' })
                    setSelectedImage(null)
                    setPreviewImage(null)
                    setErrors({})
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>

              <form onSubmit={handleUpdateDelivery} className="space-y-4">
                {/* Foto de Perfil */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Foto de Perfil (Opcional)
                  </label>
                  <div className="flex items-center space-x-4">
                    <div className="h-16 w-16 flex-shrink-0">
                      {previewImage ? (
                        <img
                          src={previewImage}
                          alt="Preview"
                          className="h-16 w-16 rounded-full object-cover border-2 border-gray-300"
                        />
                      ) : (
                        <div className="h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center">
                          <i className="bi bi-person text-2xl text-gray-400"></i>
                        </div>
                      )}
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
                      >
                        <i className="bi bi-camera me-1"></i>
                        Cambiar
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageSelect}
                        className="hidden"
                      />
                    </div>
                  </div>
                  {errors.image && (
                    <p className="text-red-500 text-xs mt-1">{errors.image}</p>
                  )}
                </div>

                {/* Nombres */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombres Completos *
                  </label>
                  <input
                    type="text"
                    value={formData.nombres}
                    onChange={(e) => setFormData({ ...formData, nombres: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 ${
                      errors.nombres ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="Juan Pérez Rodríguez"
                  />
                  {errors.nombres && (
                    <p className="text-red-500 text-xs mt-1">{errors.nombres}</p>
                  )}
                </div>

                {/* Celular */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Celular *
                  </label>
                  <input
                    type="tel"
                    value={formData.celular}
                    onChange={(e) => setFormData({ ...formData, celular: normalizePhone(e.target.value) })}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 ${
                      errors.celular ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="0987654321"
                  />
                  {errors.celular && (
                    <p className="text-red-500 text-xs mt-1">{errors.celular}</p>
                  )}
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 ${
                      errors.email ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="juan@example.com"
                  />
                  {errors.email && (
                    <p className="text-red-500 text-xs mt-1">{errors.email}</p>
                  )}
                </div>

                {/* Estado */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Estado *
                  </label>
                  <select
                    value={formData.estado}
                    onChange={(e) => setFormData({ ...formData, estado: e.target.value as 'activo' | 'inactivo' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  >
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                  </select>
                </div>

                {errors.submit && (
                  <div className="text-red-500 text-sm text-center">
                    {errors.submit}
                  </div>
                )}

                {/* Botones */}
                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditModal(false)
                      setEditingDelivery(null)
                      setFormData({ nombres: '', celular: '', email: '', estado: 'activo' })
                      setSelectedImage(null)
                      setPreviewImage(null)
                      setErrors({})
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || uploadingImage}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {submitting || uploadingImage ? (
                      <>
                        <i className="bi bi-arrow-clockwise animate-spin me-2"></i>
                        {uploadingImage ? 'Subiendo...' : 'Actualizando...'}
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check-circle me-2"></i>
                        Actualizar Delivery
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
