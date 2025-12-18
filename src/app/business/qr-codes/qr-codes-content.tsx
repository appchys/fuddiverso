'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { getQRCodesByBusiness, createQRCode, updateQRCode, deleteQRCode, uploadImage } from '@/lib/database'
import { QRCode } from '@/types'
import QRCodeLib from 'qrcode'
import QRStatistics from '@/components/QRStatistics'

interface QRCodesContentProps {
  businessId?: string | null
}

export default function QRCodesContent({ businessId: initialBusinessId }: QRCodesContentProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [qrCodes, setQrCodes] = useState<QRCode[]>([])
  const [businessId, setBusinessId] = useState<string>(initialBusinessId || '')
  const [generating, setGenerating] = useState(false)
  const [qrImages, setQrImages] = useState<{ [key: string]: string }>({})
  const [activeTab, setActiveTab] = useState<'overview' | 'scans' | 'users'>('overview')

  // Estado para el modal de generación/edición
  const [showModal, setShowModal] = useState(false)
  const [editingCodeId, setEditingCodeId] = useState<string | null>(null) // null para creación
  const [newCodeName, setNewCodeName] = useState('')
  const [newCodePoints, setNewCodePoints] = useState(10)
  const [newCodeIsActive, setNewCodeIsActive] = useState(true)
  const [newCodeColor, setNewCodeColor] = useState('#f3f4f6') // Color del código QR
  const [newCodeImage, setNewCodeImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [nameError, setNameError] = useState('')
  const [modalTitle, setModalTitle] = useState('Generar Nuevo Código QR')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [containerColor, setContainerColor] = useState('#f3f4f6') // Color personalizable del contenedor

  useEffect(() => {
    if (initialBusinessId) {
      setBusinessId(initialBusinessId)
      loadQRCodes(initialBusinessId)
      return
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Fallback for standalone usage if any
        if (!businessId) {
          const defaultBusinessId = '0FeNtdYThoTRMPJ6qaS7'
          setBusinessId(defaultBusinessId)
          await loadQRCodes(defaultBusinessId)
        }
      } else {
        router.push('/login')
      }
    })

    return () => unsubscribe()
  }, [router, initialBusinessId])

  // Leer el parámetro 'tab' de la URL cuando cambia
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'users' || tab === 'scans' || tab === 'overview') {
      setActiveTab(tab)
    }
  }, [searchParams])

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
      setNewCodeColor(code.color || '#f3f4f6')
      setImagePreview(code.image || null)
      setNewCodeImage(null)
      setModalTitle('Editar Código QR')
    } else {
      // Modo creación
      setEditingCodeId(null)
      setNewCodeName('')
      setNewCodePoints(10)
      setNewCodeIsActive(true)
      setNewCodeColor('#f3f4f6')
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
        color: newCodeColor,
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
      setNewCodeColor('#f3f4f6')
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

  const handleCopyLink = (qrCodeId: string) => {
    const baseUrl = window.location.origin
    const scanUrl = `${baseUrl}/scan/${qrCodeId}`

    // Intentar usar la API moderna de clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(scanUrl).then(() => {
        alert('¡Link copiado al portapapeles!')
      }).catch(err => {
        console.error('Error al copiar el link:', err)
        // Intentar método alternativo si falla
        fallbackCopyToClipboard(scanUrl)
      })
    } else {
      // Método alternativo para navegadores que no soportan clipboard API
      fallbackCopyToClipboard(scanUrl)
    }
  }

  const fallbackCopyToClipboard = (text: string) => {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.position = 'fixed'
    textArea.style.left = '-999999px'
    textArea.style.top = '-999999px'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()

    try {
      const successful = document.execCommand('copy')
      if (successful) {
        alert('¡Link copiado al portapapeles!')
      } else {
        alert('No se pudo copiar el link. Por favor, cópialo manualmente: ' + text)
      }
    } catch (err) {
      console.error('Error al copiar:', err)
      alert('No se pudo copiar el link. Por favor, cópialo manualmente: ' + text)
    }

    document.body.removeChild(textArea)
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
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-8 border-b border-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-gray-50/30">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Fidelización QR</h2>
          <p className="text-xs text-gray-400 font-black uppercase tracking-widest mt-1">Crea campañas de recompensas para tus clientes</p>
        </div>
        <button
          onClick={() => openModal()}
          disabled={generating}
          className="bg-red-600 text-white px-8 py-4 rounded-2xl font-black uppercase text-xs hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all shadow-xl shadow-red-100 active:scale-95 flex items-center gap-2"
        >
          <i className="bi bi-plus-lg"></i>
          Nuevo Código
        </button>
      </div>

      <div className="p-8">
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {qrCodes.map((qrCode, index) => (
              <div
                key={qrCode.id}
                className="relative rounded-xl shadow-md hover:shadow-xl transition-all duration-300"
                style={{ backgroundColor: qrCode.color || containerColor }}
              >
                {/* Menú de 3 puntos */}
                <div className="absolute top-2 right-2 z-10">
                  <button
                    onClick={() => setOpenMenuId(openMenuId === qrCode.id ? null : qrCode.id)}
                    className="bg-white bg-opacity-90 hover:bg-opacity-100 rounded-full p-2 shadow-md transition-all"
                  >
                    <i className="bi bi-three-dots-vertical text-gray-700"></i>
                  </button>

                  {/* Dropdown menu */}
                  {openMenuId === qrCode.id && (
                    <>
                      {/* Overlay para cerrar el menú al hacer clic fuera */}
                      <div
                        className="fixed inset-0 z-20"
                        onClick={() => setOpenMenuId(null)}
                      ></div>

                      <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-30">
                        <button
                          onClick={() => {
                            handleDownloadQR(qrCode.id, qrCode.name)
                            setOpenMenuId(null)
                          }}
                          className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center text-sm text-gray-700"
                        >
                          <i className="bi bi-download me-2"></i>
                          Descargar
                        </button>
                        <button
                          onClick={() => {
                            handlePrintQR(qrCode.id)
                            setOpenMenuId(null)
                          }}
                          className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center text-sm text-gray-700"
                        >
                          <i className="bi bi-printer me-2"></i>
                          Imprimir
                        </button>
                        <button
                          onClick={() => {
                            handleCopyLink(qrCode.id)
                            setOpenMenuId(null)
                          }}
                          className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center text-sm text-gray-700"
                        >
                          <i className="bi bi-link-45deg me-2"></i>
                          Copiar link
                        </button>
                        <button
                          onClick={() => {
                            openModal(qrCode)
                            setOpenMenuId(null)
                          }}
                          className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center text-sm text-gray-700"
                        >
                          <i className="bi bi-pencil me-2"></i>
                          Editar
                        </button>
                        <hr className="my-1 border-gray-200" />
                        <button
                          onClick={() => {
                            handleDeleteQR(qrCode.id, qrCode.name)
                            setOpenMenuId(null)
                          }}
                          className="w-full text-left px-4 py-2 hover:bg-red-50 flex items-center text-sm text-red-600"
                        >
                          <i className="bi bi-trash me-2"></i>
                          Eliminar
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Badge de estado */}
                <div className="absolute top-2 left-2 z-10">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${qrCode.isActive
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-500 text-white'
                    }`}>
                    {qrCode.isActive ? 'Activo' : 'Inactivo'}
                  </span>
                </div>

                <div className="p-4">
                  {/* Imagen circular */}
                  <div className="flex justify-center mb-3">
                    <div className="relative">
                      {qrCode.image ? (
                        <img
                          src={qrCode.image}
                          alt={qrCode.name}
                          className="w-20 h-20 rounded-full object-cover border-4 border-white shadow-md"
                        />
                      ) : (
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 border-4 border-white shadow-md flex items-center justify-center">
                          <i className="bi bi-image text-2xl text-gray-400"></i>
                        </div>
                      )}
                      {/* Badge de puntos */}
                      <span className="absolute -bottom-1 -right-1 bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-md">
                        {qrCode.points} pts
                      </span>
                    </div>
                  </div>

                  {/* Nombre */}
                  <h3 className="text-center font-bold text-sm text-gray-800 mb-3 truncate px-2">
                    {qrCode.name}
                  </h3>

                  {/* Código QR */}
                  <div className="bg-white rounded-lg p-3 mb-2 flex items-center justify-center border-2 border-gray-200">
                    {qrImages[qrCode.id] ? (
                      <img
                        src={qrImages[qrCode.id]}
                        alt={qrCode.name}
                        className="w-full max-w-[120px]"
                      />
                    ) : (
                      <i className="bi bi-qr-code text-4xl text-gray-300"></i>
                    )}
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

        {/* Estadísticas de QR */}
        {qrCodes.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center">
              <i className="bi bi-graph-up me-2 text-red-600"></i>
              Estadísticas de Códigos QR
            </h2>
            <QRStatistics businessId={businessId} qrCodes={qrCodes} initialTab={activeTab} />
          </div>
        )}
      </div>

      {/* Modal para Generar/Editar Código */}
      {
        showModal && (
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Color de Fondo
                </label>
                <div className="flex items-center gap-3">
                  {/* Color picker visual */}
                  <input
                    type="color"
                    value={newCodeColor}
                    onChange={(e) => setNewCodeColor(e.target.value)}
                    className="w-12 h-12 rounded-lg cursor-pointer border-2 border-gray-300"
                  />

                  {/* Hexadecimal input */}
                  <div className="flex-1">
                    <input
                      type="text"
                      value={newCodeColor}
                      onChange={(e) => {
                        const value = e.target.value
                        // Validar que sea un color hexadecimal válido
                        if (/^#[0-9A-Fa-f]{0,6}$/.test(value)) {
                          setNewCodeColor(value)
                        }
                      }}
                      placeholder="#f3f4f6"
                      maxLength={7}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 font-mono text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-1">Formato: #RRGGBB</p>
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
        )
      }
    </div>
  )
}
