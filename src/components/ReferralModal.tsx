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
    const text = `¡Mira este producto de ${businessName}! - ${referralLink}`
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
              {referralLink ? (
                <p className="text-xs text-gray-900 break-all font-mono animate-in fade-in duration-300">{referralLink}</p>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-400 font-medium py-0.5 animate-pulse">
                  <i className="bi bi-arrow-repeat animate-spin text-red-500"></i>
                  <span>Generando tu enlace único...</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              disabled={!referralLink}
              title={copied ? '¡Enlace copiado!' : 'Copiar enlace'}
              className={`flex-1 py-2.5 rounded-2xl font-bold transition-all flex flex-col items-center justify-center gap-1 active:scale-95 shadow-sm disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed ${
                copied ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-white hover:bg-black'
              }`}
            >
              <i className={`bi ${copied ? 'bi-check-lg' : 'bi-clipboard'} text-xl`}></i>
              <span className="text-[11px] font-bold tracking-tight">{copied ? 'Copiado' : 'Copiar'}</span>
            </button>

            <button
              onClick={shareOnWhatsApp}
              disabled={!referralLink}
              title="Compartir en WhatsApp"
              className="flex-1 py-2.5 bg-emerald-500 text-white font-bold rounded-2xl hover:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1 active:scale-95 shadow-sm"
            >
              <i className="bi bi-whatsapp text-xl"></i>
              <span className="text-[11px] font-bold tracking-tight">WhatsApp</span>
            </button>

            <button
              onClick={shareOnFacebook}
              disabled={!referralLink}
              title="Compartir en Facebook"
              className="flex-1 py-2.5 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1 active:scale-95 shadow-sm"
            >
              <i className="bi bi-facebook text-xl"></i>
              <span className="text-[11px] font-bold tracking-tight">Facebook</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
