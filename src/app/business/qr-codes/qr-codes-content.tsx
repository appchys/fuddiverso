'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { getQRCodesByBusiness, createQRCode, updateQRCode, deleteQRCode, uploadImage } from '@/lib/database'
import { QRCode } from '@/types'
import QRStatistics from '@/components/QRStatistics'

interface QRCodesContentProps {
  businessId?: string | null
}

function generateLocalShortId(length: number = 6): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
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

  const [showModal, setShowModal] = useState(false)
  const [editingCodeId, setEditingCodeId] = useState<string | null>(null)
  const [newCodeName, setNewCodeName] = useState('')
  const [newCodePrize, setNewCodePrize] = useState('')
  const [newCodePoints, setNewCodePoints] = useState(10)
  const [newCodeIsActive, setNewCodeIsActive] = useState(true)
  const [newCodeColor, setNewCodeColor] = useState('#f3f4f6')
  const [newCodeImage, setNewCodeImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [nameError, setNameError] = useState('')
  const [modalTitle, setModalTitle] = useState('Generar Nuevo Código QR')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const lastLoadedId = useRef<string | null>(null)

  const loadQRCodes = useCallback(async (bizId: string) => {
    if (!bizId) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const codes = await getQRCodesByBusiness(bizId)
      setQrCodes(codes)
      lastLoadedId.current = bizId
      setLoading(false)

      if (typeof window === 'undefined') return

      const QRCodeStyling = (await import('qr-code-styling')).default
      const images: { [key: string]: string } = {}
      const baseUrl = window.location.origin

      for (const code of codes) {
        try {
          const scanUrl = `${baseUrl}/scan/${code.id}`
          const qrCode = new QRCodeStyling({
            width: 300,
            height: 300,
            data: scanUrl,
            margin: 10,
            qrOptions: { errorCorrectionLevel: 'H' },
            dotsOptions: { color: '#DC2626', type: 'dots' },
            backgroundOptions: { color: 'transparent' },
            cornersSquareOptions: { color: '#DC2626', type: 'extra-rounded' },
            cornersDotOptions: { color: '#DC2626', type: 'dot' }
          })

          const blob = await qrCode.getRawData('png') as Blob
          if (blob) {
            const dataUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader()
              reader.onloadend = () => resolve(reader.result as string)
              reader.readAsDataURL(blob)
            })
            images[code.id] = dataUrl
            setQrImages(prev => ({ ...prev, [code.id]: dataUrl }))
          }
        } catch (error) {
          console.error('Error generating QR image for:', code.id, error)
        }
      }
    } catch (error) {
      console.error('Error in loadQRCodes:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialBusinessId) {
      setBusinessId(initialBusinessId)
      loadQRCodes(initialBusinessId)
      return
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
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
  }, [initialBusinessId])

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'users' || tab === 'scans' || tab === 'overview') {
      setActiveTab(tab)
    }
  }, [searchParams])

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setNewCodeImage(file)
      const reader = new FileReader()
      reader.onloadend = () => setImagePreview(reader.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleDeleteQR = useCallback(async (codeId: string, codeName: string) => {
    if (!confirm(`¿Estás seguro de que quieres eliminar "${codeName}"?`)) return
    try {
      await deleteQRCode(codeId)
      setQrCodes(prev => prev.filter(c => c.id !== codeId))
    } catch (e) {
      alert('Error al eliminar')
    }
  }, [])

  const openModal = useCallback((code?: QRCode) => {
    if (code) {
      setEditingCodeId(code.id)
      setNewCodeName(code.name)
      setNewCodePrize(code.prize || '')
      setNewCodePoints(code.points)
      setNewCodeIsActive(code.isActive)
      setNewCodeColor(code.color || '#f3f4f6')
      setImagePreview(code.image || null)
      setNewCodeImage(null)
      setModalTitle('Editar Código QR')
    } else {
      setEditingCodeId(null)
      setNewCodeName('')
      setNewCodePrize('')
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
    if (!newCodeName.trim()) { setNameError('Requerido'); return; }
    if (!businessId) return

    setGenerating(true)
    setIsUploading(true)
    try {
      let imageUrl = imagePreview || ''
      if (newCodeImage) {
        const filePath = `qrcodes/${Date.now()}_${newCodeImage.name}`
        imageUrl = await uploadImage(newCodeImage, filePath)
      }

      const codeData: any = {
        name: newCodeName.trim(),
        prize: newCodePrize.trim(),
        points: newCodePoints,
        isActive: newCodeIsActive,
        color: newCodeColor,
        businessId: businessId,
        image: imageUrl
      }

      if (editingCodeId) {
        await updateQRCode(editingCodeId, codeData)
      } else {
        const shortId = generateLocalShortId(6)
        await createQRCode(codeData, shortId)
      }

      setShowModal(false)
      lastLoadedId.current = null
      await loadQRCodes(businessId)
    } catch (e: any) {
      console.error('Error saving QR code:', e)
      alert(`Error al guardar: ${e.message || 'Error desconocido'}`)
    } finally {
      setGenerating(false)
      setIsUploading(false)
    }
  }

  const handleDownloadQR = async (qr: QRCode) => {
    if (typeof window === 'undefined') return
    const QRCodeStyling = (await import('qr-code-styling')).default
    const baseUrl = window.location.origin
    const scanUrl = `${baseUrl}/scan/${qr.id}`

    const qrForDownload = new QRCodeStyling({
      width: 2000,
      height: 2000,
      data: scanUrl,
      margin: 20,
      qrOptions: { errorCorrectionLevel: 'H' },
      dotsOptions: { color: '#DC2626', type: 'dots' },
      backgroundOptions: { color: 'transparent' },
      cornersSquareOptions: { color: '#DC2626', type: 'extra-rounded' },
      cornersDotOptions: { color: '#DC2626', type: 'dot' }
    })

    qrForDownload.download({
      name: qr.name.replace(/\s+/g, '_'),
      extension: 'png'
    })
  }

  if (loading) return (
    <div className="min-h-[400px] flex flex-col items-center justify-center bg-white rounded-3xl p-12 border border-gray-100">
      <i className="bi bi-arrow-repeat animate-spin text-red-600 text-5xl mb-4"></i>
      <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Cargando códigos...</p>
    </div>
  )

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-8 border-b border-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-gray-50/30">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Fidelización QR</h2>
          <p className="text-xs text-gray-400 font-black uppercase tracking-widest mt-1">Crea campañas de recompensas para tus clientes</p>
        </div>
        <button onClick={() => openModal()} className="bg-red-600 text-white px-8 py-4 rounded-2xl font-black uppercase text-xs hover:bg-red-700 transition-all shadow-xl shadow-red-100 active:scale-95 flex items-center gap-2">
          <i className="bi bi-plus-lg"></i> Nuevo Código
        </button>
      </div>

      <div className="p-8">
        {qrCodes.length === 0 ? (
          <div className="text-center p-12 text-gray-400">
            <i className="bi bi-qr-code text-6xl mb-4"></i>
            <p className="font-bold">No hay códigos configurados para este negocio</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {qrCodes.map((qr) => (
              <div key={qr.id} className="relative rounded-xl shadow-md p-4 transition-all" style={{ backgroundColor: qr.color || '#f3f4f6' }}>
                <div className="absolute top-2 right-2 z-10">
                  <button onClick={() => setOpenMenuId(openMenuId === qr.id ? null : qr.id)} className="bg-white/90 rounded-full p-1 shadow-sm"><i className="bi bi-three-dots-vertical"></i></button>
                  {openMenuId === qr.id && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border p-2 z-30">
                      <button onClick={() => { handleDownloadQR(qr); setOpenMenuId(null); }} className="w-full text-left p-2 hover:bg-gray-50 text-sm flex items-center gap-2"><i className="bi bi-download"></i> Descargar</button>
                      <button onClick={() => { openModal(qr); setOpenMenuId(null); }} className="w-full text-left p-2 hover:bg-gray-50 text-sm flex items-center gap-2"><i className="bi bi-pencil"></i> Editar</button>
                      <button onClick={() => { handleDeleteQR(qr.id, qr.name); setOpenMenuId(null); }} className="w-full text-left p-2 hover:bg-red-50 text-sm text-red-600 flex items-center gap-2"><i className="bi bi-trash"></i> Eliminar</button>
                    </div>
                  )}
                </div>
                <div className="flex justify-center mb-3">
                  <div className="w-16 h-16 rounded-full border-4 border-white shadow-sm overflow-hidden bg-white flex items-center justify-center">
                    {qr.image ? (
                      <img src={qr.image} className="w-full h-full object-cover" alt={qr.name} />
                    ) : (
                      <i className="bi bi-qr-code text-gray-200 text-xl"></i>
                    )}
                  </div>
                </div>
                <h3 className="text-center font-bold text-sm truncate px-1">{qr.name}</h3>
                <div className="bg-white rounded-lg p-2 mt-3 flex justify-center border aspect-square items-center">
                  {qrImages[qr.id] ? (
                    <img src={qrImages[qr.id]} className="w-full h-full object-contain" alt="QR Code" />
                  ) : (
                    <i className="bi bi-qr-code text-gray-100 text-4xl"></i>
                  )}
                </div>
                <div className="mt-2 text-center">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${qr.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {qr.isActive ? 'ACTIVO' : 'INACTIVO'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {qrCodes.length > 0 && (
          <div className="mt-12">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2"><i className="bi bi-graph-up text-red-600"></i> Estadísticas</h2>
            <QRStatistics businessId={businessId} qrCodes={qrCodes} initialTab={activeTab} />
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl overflow-y-auto max-h-[90vh]">
            <h2 className="text-xl font-bold mb-6 text-gray-800 border-b pb-4">{modalTitle}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Nombre</label>
                <input type="text" value={newCodeName} onChange={(e) => { setNewCodeName(e.target.value); setNameError(''); }} className="w-full p-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-red-500 outline-none font-bold" />
                {nameError && <p className="text-red-500 text-xs mt-1">{nameError}</p>}
              </div>
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Premio (Opcional)</label>
                <textarea value={newCodePrize} onChange={(e) => setNewCodePrize(e.target.value)} className="w-full p-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-red-500 outline-none" rows={2} />
              </div>
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Color de Fondo</label>
                <div className="flex gap-4">
                  <input type="color" value={newCodeColor} onChange={(e) => setNewCodeColor(e.target.value)} className="w-12 h-12 rounded-xl border-none cursor-pointer" />
                  <input type="text" value={newCodeColor} onChange={(e) => setNewCodeColor(e.target.value)} className="flex-1 p-3 bg-gray-50 border-none rounded-xl font-mono text-sm uppercase" maxLength={7} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Puntos</label>
                  <input type="number" value={newCodePoints} onChange={(e) => setNewCodePoints(Number(e.target.value))} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-bold" />
                </div>
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Estado</label>
                  <button onClick={() => setNewCodeIsActive(!newCodeIsActive)} className={`w-full p-4 rounded-2xl font-bold transition-all ${newCodeIsActive ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                    {newCodeIsActive ? 'ACTIVO' : 'INACTIVO'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Imagen de Campaña</label>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-2xl bg-gray-50 flex items-center justify-center overflow-hidden border-2 border-dashed border-gray-200">
                    {imagePreview ? <img src={imagePreview} className="w-full h-full object-cover" alt="Preview" /> : <i className="bi bi-image text-gray-300 text-2xl"></i>}
                  </div>
                  <div className="flex-1">
                    <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" id="qr-image-upload" />
                    <label htmlFor="qr-image-upload" className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors inline-block">
                      <i className="bi bi-cloud-upload me-2"></i>
                      {imagePreview ? 'Cambiar Imagen' : 'Subir Imagen'}
                    </label>
                    {imagePreview && (
                      <button onClick={() => { setImagePreview(null); setNewCodeImage(null); }} className="block mt-2 text-red-500 text-[10px] font-bold uppercase tracking-wider">
                        Eliminar imagen
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-6">
                <button onClick={() => setShowModal(false)} className="flex-1 py-4 font-bold text-gray-400">Cancelar</button>
                <button onClick={handleSaveCode} disabled={generating || isUploading || !newCodeName.trim()} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black uppercase text-xs shadow-xl shadow-red-100 disabled:bg-gray-200">
                  {generating || isUploading ? (editingCodeId ? 'Actualizando...' : 'Guardando...') : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
