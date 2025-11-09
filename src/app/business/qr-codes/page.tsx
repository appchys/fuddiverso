'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { getQRCodesByBusiness, createQRCode, updateQRCode, deleteQRCode, uploadImage } from '@/lib/database'
import { QRCode } from '@/types'
import QRCodeLib from 'qrcode'

export default function QRCodesManagementPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [qrCodes, setQrCodes] = useState<QRCode[]>([])
  const [businessId, setBusinessId] = useState<string>('')
  const [generating, setGenerating] = useState(false)
  const [qrImages, setQrImages] = useState<{ [key: string]: string }>({})

  // Estado para el modal de generación/edición
  const [showModal, setShowModal] = useState(false)
  const [editingCodeId, setEditingCodeId] = useState<string | null>(null) // null para creación
  const [newCodeName, setNewCodeName] = useState('')
  const [newCodePoints, setNewCodePoints] = useState(10)
  const [newCodeIsActive, setNewCodeIsActive] = useState(true)
  const [newCodeImage, setNewCodeImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [nameError, setNameError] = useState('')
  const [modalTitle, setModalTitle] = useState('Generar Nuevo Código QR')

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Por ahora usaremos un businessId de ejemplo
        const defaultBusinessId = '0FeNtdYThoTRMPJ6qaS7' // Reemplazar con el ID real del negocio
        setBusinessId(defaultBusinessId)
        await loadQRCodes(defaultBusinessId)
      } else {
        router.push('/login')
      }
    })

    return () => unsubscribe()
  }, [router])

  const loadQRCodes = useCallback(async (bizId: string) => {
    try {
      setLoading(true)
      const codes = await getQRCodesByBusiness(bizId)
      setQrCodes(codes)
      
      // Generar imágenes QR para cada código
      const images: { [key: string]: string } = {}
      const baseUrl = window.location.origin
      
      for (const code of codes) {
        try {
          const scanUrl = `${baseUrl}/scan/${code.id}`
          const qrDataUrl = await QRCodeLib.toDataURL(scanUrl, {
            width: 300,
            margin: 2,
            color: {
              dark: '#DC2626',
              light: '#FFFFFF'
            }
          })
          images[code.id] = qrDataUrl
        } catch (error) {
          console.error('Error generating QR image:', error)
        }
      }
      setQrImages(images)
    } catch (error) {
      console.error('Error loading QR codes:', error)
      alert('Error al cargar los códigos QR. Intenta recargar la página.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Función para eliminar un código QR
  const handleDeleteQR = useCallback(async (codeId: string, codeName: string) => {
    if (!confirm(`¿Estás seguro de que quieres eliminar el código "${codeName}"? Esta acción no se puede deshacer.`)) {
      return
    }

    try {
      await deleteQRCode(codeId)
      alert('Código QR eliminado exitosamente')
      
      // Recargar la lista y limpiar imagen
      const updatedCodes = qrCodes.filter(code => code.id !== codeId)
      setQrCodes(updatedCodes)
      const updatedImages = { ...qrImages }
      delete updatedImages[codeId]
      setQrImages(updatedImages)
    } catch (error) {
      console.error('Error deleting QR code:', error)
      alert('Error al eliminar el código QR. Verifica tu conexión.')
    }
  }, [qrCodes, qrImages])

  // Abrir modal para edición o creación
  // Manejar selección de imagen
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setNewCodeImage(file)
      
      // Crear vista previa
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const openModal = useCallback((code?: QRCode) => {
    if (code) {
      // Modo edición
      setEditingCodeId(code.id)
      setNewCodeName(code.name)
      setNewCodePoints(code.points)
      setNewCodeIsActive(code.isActive)
      setImagePreview(code.image || null)
      setNewCodeImage(null)
      setModalTitle('Editar Código QR')
    } else {
      // Modo creación
      setEditingCodeId(null)
      setNewCodeName('')
      setNewCodePoints(10)
      setNewCodeIsActive(true)
      setImagePreview(null)
      setNewCodeImage(null)
      setModalTitle('Generar Nuevo Código QR')
    }
    setNameError('')
    setShowModal(true)
  }, [])

  const handleSaveCode = async () => {
    if (!newCodeName.trim()) {
      setNameError('El nombre es requerido.')
      return
    }
    if (newCodePoints <= 0) {
      alert('Los puntos deben ser mayores a 0.')
      return
    }

    if (!businessId) return
    
    setGenerating(true)
    setIsUploading(true)
    try {
      let imageUrl = imagePreview || ''
      
      // Subir imagen si hay una nueva
      if (newCodeImage) {
        const filePath = `qrcodes/${Date.now()}_${newCodeImage.name}`
        imageUrl = await uploadImage(newCodeImage, filePath)
      }

      const codeData: any = {
        name: newCodeName.trim(),
        points: newCodePoints,
        isActive: newCodeIsActive,
        businessId: businessId
      }

      // Solo incluir la URL de la imagen si existe
      if (imageUrl) {
        codeData.image = imageUrl
      }

      if (editingCodeId) {
        // Edición: actualizar existente
        await updateQRCode(editingCodeId, codeData)
        alert('Código QR actualizado exitosamente')
      } else {
        // Creación: nuevo código
        await createQRCode(codeData)
        alert('Código QR generado exitosamente')
      }

      // Limpiar formulario y cerrar modal
      setNewCodeName('')
      setNewCodePoints(10)
      setNewCodeIsActive(true)
      setNewCodeImage(null)
      setImagePreview(null)
      setNameError('')
      setEditingCodeId(null)
      setShowModal(false)

      await loadQRCodes(businessId)
    } catch (error) {
      console.error('Error saving QR code:', error)
      alert('Error al guardar el código QR. Verifica tu conexión.')
    } finally {
      setGenerating(false)
      setIsUploading(false)
    }
  }

  const handleDownloadQR = (qrCodeId: string, name: string) => {
    const imageUrl = qrImages[qrCodeId]
    if (!imageUrl) return

    const link = document.createElement('a')
    link.href = imageUrl
    link.download = `${name.replace(/\s+/g, '_')}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handlePrintQR = (qrCodeId: string) => {
    const imageUrl = qrImages[qrCodeId]
    if (!imageUrl) return

    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write(`
      <html>
        <head>
          <title>Imprimir Código QR</title>
          <style>
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              font-family: Arial, sans-serif;
            }
            .container {
              text-align: center;
              padding: 20px;
            }
            img {
              max-width: 400px;
              border: 2px solid #DC2626;
              border-radius: 8px;
              padding: 20px;
            }
            h2 {
              color: #DC2626;
              margin-top: 20px;
            }
            @media print {
              body {
                margin: 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <img src="${imageUrl}" alt="Código QR" />
            <h2>Escanea para participar</h2>
          </div>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      printWindow.print()
    }, 250)
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
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <button
            onClick={() => router.back()}
            className="mb-4 flex items-center text-gray-600 hover:text-gray-800 transition-colors"
          >
            <i className="bi bi-arrow-left me-2"></i>
            Volver
          </button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Códigos QR</h1>
              <p className="text-gray-600 mt-1">
                Gestiona los códigos QR para la colección de clientes
              </p>
            </div>
            
            <button
              onClick={() => openModal()}
              disabled={generating}
              className="bg-red-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center"
            >
              <i className="bi bi-plus-lg me-2"></i>
              Generar Código Nuevo
            </button>
          </div>
        </div>
      </div>

      {/* Contenido */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {qrCodes.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <i className="bi bi-qr-code text-6xl text-gray-400 mb-4"></i>
            <h3 className="text-xl font-bold text-gray-800 mb-2">
              No hay códigos QR configurados
            </h3>
            <p className="text-gray-600 mb-6">
              Genera tu primer código QR para comenzar la campaña de colección
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {qrCodes.map((qrCode, index) => (
              <div
                key={qrCode.id}
                className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
              >
                <div className="bg-gradient-to-r from-red-500 to-red-600 p-4 text-white">
                  <div className="flex items-center justify-between">
                    {/* CAMBIO: Ahora usamos el nombre real como título principal */}
                    <h3 className="font-bold text-lg truncate">{qrCode.name}</h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      qrCode.isActive
                        ? 'bg-green-500 bg-opacity-20 border border-green-300'
                        : 'bg-gray-500 bg-opacity-20 border border-gray-300'
                    }`}>
                      {qrCode.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </div>

                <div className="p-6">
                  <div className="relative">
                    {qrCode.image ? (
                      <img 
                        src={qrCode.image} 
                        alt={qrCode.name}
                        className="w-full h-40 object-cover rounded-lg mb-4"
                      />
                    ) : (
                      <div className="w-full h-40 bg-gradient-to-r from-gray-100 to-gray-200 rounded-lg flex items-center justify-center mb-4">
                        <i className="bi bi-image text-4xl text-gray-300"></i>
                      </div>
                    )}
                    <span className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded-full">
                      {qrCode.points} pts
                    </span>
                  </div>
                  
                  <div className="bg-white border-2 border-red-200 rounded-lg p-4 mb-4 flex items-center justify-center">
                    {qrImages[qrCode.id] ? (
                      <img
                        src={qrImages[qrCode.id]}
                        alt={qrCode.name}
                        className="w-full max-w-[200px]"
                      />
                    ) : (
                      <i className="bi bi-qr-code text-6xl text-gray-300"></i>
                    )}
                  </div>

                  {/* CAMBIO: Eliminamos el h4 duplicado del nombre, ya que ahora está en el header */}
                  <p className="text-sm text-gray-600 mb-4">
                    <i className="bi bi-star-fill text-yellow-500 me-1"></i>
                    {qrCode.points} puntos
                  </p>

                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => handleDownloadQR(qrCode.id, qrCode.name)}
                      className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                      <i className="bi bi-download me-1"></i>
                      Descargar
                    </button>
                    <button
                      onClick={() => handlePrintQR(qrCode.id)}
                      className="flex-1 bg-gray-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
                    >
                      <i className="bi bi-printer me-1"></i>
                      Imprimir
                    </button>
                    <button
                      onClick={() => openModal(qrCode)}
                      className="flex-1 bg-yellow-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-yellow-700 transition-colors"
                    >
                      <i className="bi bi-pencil me-1"></i>
                      Editar
                    </button>
                  </div>

                  {/* Botón de eliminar */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleDeleteQR(qrCode.id, qrCode.name)}
                      className="text-red-600 hover:text-red-800 text-sm font-medium transition-colors flex items-center"
                    >
                      <i className="bi bi-trash me-1"></i>
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Instrucciones */}
        {qrCodes.length > 0 && (
          <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="font-bold text-blue-900 mb-3 flex items-center">
              <i className="bi bi-info-circle-fill me-2"></i>
              Instrucciones
            </h3>
            <ul className="text-sm text-blue-800 space-y-2">
              <li>• Genera o edita códigos QR según necesites</li>
              <li>• Descarga o imprime cada código QR</li>
              <li>• Coloca los códigos en diferentes ubicaciones del establecimiento</li>
              <li>• Los clientes deben escanear los códigos para completar la colección</li>
              <li>• Cada cliente solo puede escanear cada código una vez</li>
              <li>• Al completar la colección, el cliente puede reclamar su recompensa</li>
            </ul>
          </div>
        )}
      </div>

      {/* Modal para Generar/Editar Código */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-gray-800 mb-4">{modalTitle}</h2>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Nombre del Código *</label>
              <input
                type="text"
                value={newCodeName}
                onChange={(e) => {
                  setNewCodeName(e.target.value)
                  if (nameError) setNameError('')
                }}
                placeholder="Ej: Entrada Principal"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              {nameError && <p className="text-red-500 text-sm mt-1">{nameError}</p>}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Imagen (Opcional)
              </label>
              <div className="mt-1 flex items-center">
                <label className="cursor-pointer">
                  <div className="w-24 h-24 rounded-md overflow-hidden bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center">
                    {imagePreview ? (
                      <img 
                        src={imagePreview} 
                        alt="Vista previa" 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-gray-400">
                        <i className="bi bi-image text-2xl"></i>
                      </div>
                    )}
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={handleImageChange}
                  />
                </label>
                <div className="ml-4 text-sm text-gray-500">
                  <p>Haz clic para subir una imagen</p>
                  <p className="text-xs">Tamaño recomendado: 500x500px</p>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Puntos</label>
              <input
                type="number"
                value={newCodePoints}
                onChange={(e) => setNewCodePoints(Number(e.target.value))}
                min="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="mb-6">
              <label className="flex items-center text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={newCodeIsActive}
                  onChange={(e) => setNewCodeIsActive(e.target.checked)}
                  className="mr-2"
                />
                Activo
              </label>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowModal(false)
                  setNewCodeName('')
                  setNewCodePoints(10)
                  setNewCodeIsActive(true)
                  setNameError('')
                  setEditingCodeId(null)
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveCode}
                disabled={generating || !newCodeName.trim()}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {generating ? (
                  <span className="flex items-center">
                    <i className="bi bi-arrow-repeat animate-spin me-2"></i>
                    Guardando...
                  </span>
                ) : editingCodeId ? (
                  'Actualizar'
                ) : (
                  'Generar'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}