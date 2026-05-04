'use client'

import { useState, useEffect } from 'react'

export default function ReferralModal({
  isOpen,
  onClose,
  product,
  referralLink,
  businessName
}: {
  isOpen: boolean
  onClose: () => void
  product: any
  referralLink: string
  businessName: string
}) {
  const [copied, setCopied] = useState(false)
  const [recommendation, setRecommendation] = useState('')

  useEffect(() => {
    if (!isOpen) {
      setRecommendation('')
    }
  }, [isOpen])

  if (!isOpen || !product) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Error copying:', err)
    }
  }

  const shareOnWhatsApp = () => {
    let text: string
    if (recommendation.trim()) {
      text = `${recommendation} - ${referralLink}`
    } else {
      text = `¡Mira este producto de ${businessName}! - ${referralLink}`
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  const shareOnFacebook = () => {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}`, '_blank')
  }

  return (
    <div className="fixed inset-0 z-[160] overflow-hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 animate-in fade-in zoom-in duration-300 flex flex-col max-h-[calc(100svh-4rem)] overflow-y-auto custom-scrollbar">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all z-10"
          >
            <i className="bi bi-x-lg text-xl"></i>
          </button>

          <div className="text-center mb-6 flex-shrink-0">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🔥</span>
            </div>
            <h3 className="text-2xl font-black text-gray-900 mb-2">
              ¡Recomienda y Gana!
            </h3>
            <p className="text-gray-500 text-sm">
              Comparte este producto y gana $0,25 por cada venta completada
            </p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-4 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <img
                src={product.image}
                alt={product.name}
                className="w-12 h-12 rounded-lg object-cover"
              />
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-gray-900 text-sm truncate">{product.name}</h4>
                <p className="text-red-500 font-black text-sm">${product.price?.toFixed(2)}</p>
              </div>
            </div>

            <div className="bg-white rounded-xl p-3 border border-gray-200">
              <p className="text-xs text-gray-400 mb-1">Tu link de referido:</p>
              <p className="text-xs text-gray-900 break-all font-mono">{referralLink}</p>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">
              Tu recomendación (opcional)
            </label>
            <textarea
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value)}
              placeholder="Ej: ¡Lo probé y está increíble! Se los recomiendo..."
              maxLength={200}
              rows={3}
              className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#aa1918]/20 transition-all resize-none placeholder:text-gray-300"
            />
            <p className="text-[10px] text-gray-400 text-right mt-1">{recommendation.length}/200</p>
          </div>

          <button
            onClick={handleCopy}
            className="w-full py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-black transition-all mb-3 flex items-center justify-center gap-2"
          >
            <i className={`bi ${copied ? 'bi-check-circle' : 'bi-clipboard'}`}></i>
            {copied ? '¡Copiado!' : 'Copiar enlace'}
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={shareOnWhatsApp}
              className="py-3 bg-green-500 text-white font-bold rounded-xl hover:bg-green-600 transition-all flex items-center justify-center gap-2"
            >
              <i className="bi bi-whatsapp"></i>
              WhatsApp
            </button>
            <button
              onClick={shareOnFacebook}
              className="py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
            >
              <i className="bi bi-facebook"></i>
              Facebook
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
