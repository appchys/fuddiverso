'use client'

import { useState, useEffect } from 'react'
import { Flame, Copy, Check, Share2, Phone, ArrowRight, Loader2, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { searchClientByPhone, createClient, generateReferralLink } from '@/lib/database'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'

interface ReferralModalProps {
  isOpen: boolean
  onClose: () => void
  product: any
  referralLink?: string
  businessName?: string
  businessId?: string
  businessUsername?: string
  productSlug?: string
}

export default function ReferralModal({
  isOpen,
  onClose,
  product,
  referralLink = '',
  businessName = '',
  businessId = '',
  businessUsername = '',
  productSlug = ''
}: ReferralModalProps) {
  const { user, login } = useAuth()

  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeLink, setActiveLink] = useState(referralLink)
  const [step, setStep] = useState<'phone' | 'share'>('share')

  const effectivePhone = user?.celular || ''
  const isUserAuthenticated = Boolean(effectivePhone || user?.id)

  // Determinar paso inicial al abrir
  useEffect(() => {
    if (!isOpen) return

    setPhoneError('')
    setCopied(false)

    if (referralLink) {
      setActiveLink(referralLink)
      setStep('share')
      return
    }

    if (isUserAuthenticated) {
      setStep('share')
      // Si no tenemos link pero el usuario está autenticado, generarlo
      const generateForUser = async () => {
        if (!product?.id) return
        try {
          const resolvedBizId = businessId || product.businessId
          const resolvedBizUsername = businessUsername || product.businessUsername
          const resolvedBizName = businessName || product.businessName || ''
          const resolvedSlug = productSlug || product.slug || product.id

          const { code } = await generateReferralLink(
            product.id,
            resolvedBizId,
            user?.id || effectivePhone,
            product.name,
            product.image,
            resolvedBizName,
            resolvedBizUsername,
            resolvedSlug
          )
          const origin = typeof window !== 'undefined' ? window.location.origin : ''
          const url = `${origin}/${resolvedBizUsername}/${resolvedSlug}?ref=${code}`
          setActiveLink(url)
        } catch (err) {
          console.error('Error auto-generating referral for logged user:', err)
        }
      }
      generateForUser()
    } else {
      // Usuario no autenticado: pedir celular
      setStep('phone')
      setActiveLink('')
      setPhone('')
    }
  }, [isOpen, referralLink, isUserAuthenticated, product?.id, businessId, businessUsername, businessName, productSlug, user?.id, effectivePhone])

  if (!isOpen || !product) return null

  const handlePhoneSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()

    const cleanInput = phone.trim()
    if (!cleanInput) {
      setPhoneError('Ingresa tu número de celular')
      return
    }

    const normalized = normalizeEcuadorianPhone(cleanInput)
    if (!validateEcuadorianPhone(normalized)) {
      setPhoneError('Ingresa un número válido de 10 dígitos (ej: 0991234567)')
      return
    }

    setLoading(true)
    setPhoneError('')

    try {
      // 1. Buscar o registrar cliente para asociar recompensas
      let client = await searchClientByPhone(normalized)
      if (client) {
        login(client)
      } else {
        const newClient = await createClient({
          celular: normalized,
          nombres: 'Cliente',
          fecha_de_registro: new Date().toISOString()
        })
        if (newClient) {
          client = newClient
          login(newClient)
        }
      }

      const clientId = client?.id || normalized
      const resolvedBizId = businessId || product.businessId
      const resolvedBizUsername = businessUsername || product.businessUsername
      const resolvedBizName = businessName || product.businessName || ''
      const resolvedSlug = productSlug || product.slug || product.id

      // 2. Generar link con la cuenta/teléfono
      const { code } = await generateReferralLink(
        product.id,
        resolvedBizId,
        clientId,
        product.name,
        product.image,
        resolvedBizName,
        resolvedBizUsername,
        resolvedSlug
      )

      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const url = `${origin}/${resolvedBizUsername}/${resolvedSlug}?ref=${code}`
      setActiveLink(url)
      setStep('share')
    } catch (err) {
      console.error('Error registering phone for referral:', err)
      setPhoneError('No se pudo generar el enlace. Intenta nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!activeLink) return
    try {
      await navigator.clipboard.writeText(activeLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Error copying link:', err)
    }
  }

  const shareOnWhatsApp = () => {
    if (!activeLink) return
    const text = `¡Mira este producto en ${businessName || 'nuestra tienda'}! ${product.name} - ${activeLink}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  const shareOnFacebook = () => {
    if (!activeLink) return
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(activeLink)}`, '_blank')
  }

  return (
    <div className="fixed inset-0 z-[160] overflow-hidden flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 z-10 animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
          aria-label="Cerrar"
        >
          <X size={18} />
        </button>

        {step === 'phone' ? (
          <div>
            {/* Cabecera */}
            <div className="text-center mb-4">
              <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-2.5">
                <Flame size={24} className="fill-amber-500" />
              </div>
              <h3 className="text-xl font-black text-gray-900 tracking-tight">
                Recomienda y Gana
              </h3>
              <p className="text-xs font-medium text-gray-500 mt-1">
                Gana <span className="font-bold text-amber-600">$0.25</span> en saldo por cada venta
              </p>
            </div>

            {/* Preview de Producto */}
            <div className="flex items-center gap-3 bg-gray-50 p-2.5 rounded-2xl border border-gray-100 mb-4">
              {product.image ? (
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-11 h-11 rounded-xl object-cover flex-shrink-0 bg-white"
                />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600 flex-shrink-0">
                  <Flame size={18} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-gray-900 truncate">{product.name}</p>
                {product.price !== undefined && (
                  <p className="text-xs font-bold text-gray-500">${product.price.toFixed(2)}</p>
                )}
              </div>
            </div>

            {/* Formulario de Celular */}
            <form onSubmit={handlePhoneSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                  Tu número de celular
                </label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value)
                      if (phoneError) setPhoneError('')
                    }}
                    placeholder="0999999999"
                    className={`w-full pl-10 pr-4 py-3 bg-gray-50 border rounded-2xl text-sm font-semibold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all ${
                      phoneError ? 'border-red-300 ring-2 ring-red-100' : 'border-gray-200'
                    }`}
                    disabled={loading}
                    autoFocus
                  />
                </div>
                {phoneError && (
                  <p className="text-xs text-red-600 font-medium mt-1.5">{phoneError}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || !phone.trim()}
                className="w-full py-3 bg-gray-900 hover:bg-black text-white font-black text-sm rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-gray-900/10 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Generando enlace...</span>
                  </>
                ) : (
                  <>
                    <span>Obtener enlace</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          </div>
        ) : (
          <div>
            {/* Cabecera Enlace Listo */}
            <div className="text-center mb-4">
              <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-2.5">
                <Flame size={24} className="fill-amber-500" />
              </div>
              <h3 className="text-xl font-black text-gray-900 tracking-tight">
                ¡Tu enlace está listo!
              </h3>
              <p className="text-xs font-medium text-gray-500 mt-1">
                Gana <span className="font-bold text-amber-600">$0.25</span> en saldo por cada venta
              </p>
            </div>

            {/* Preview de Producto */}
            <div className="flex items-center gap-3 bg-gray-50 p-2.5 rounded-2xl border border-gray-100 mb-4">
              {product.image ? (
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-11 h-11 rounded-xl object-cover flex-shrink-0 bg-white"
                />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600 flex-shrink-0">
                  <Flame size={18} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-gray-900 truncate">{product.name}</p>
                {product.price !== undefined && (
                  <p className="text-xs font-bold text-gray-500">${product.price.toFixed(2)}</p>
                )}
              </div>
            </div>

            {/* Caja de Enlace */}
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-3 mb-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                Enlace para compartir
              </p>
              {activeLink ? (
                <p className="text-xs font-mono text-gray-800 break-all select-all leading-tight">
                  {activeLink}
                </p>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-400 py-1">
                  <Loader2 size={14} className="animate-spin text-amber-500" />
                  <span>Generando enlace...</span>
                </div>
              )}
            </div>

            {/* Botones de Acción */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleCopy}
                disabled={!activeLink}
                className={`py-3 rounded-2xl font-black text-xs transition-all flex flex-col items-center justify-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50 ${
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-900 hover:bg-black text-white'
                }`}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                <span>{copied ? '¡Copiado!' : 'Copiar'}</span>
              </button>

              <button
                onClick={shareOnWhatsApp}
                disabled={!activeLink}
                className="py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs rounded-2xl transition-all flex flex-col items-center justify-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50"
              >
                <i className="bi bi-whatsapp text-base leading-none"></i>
                <span>WhatsApp</span>
              </button>

              <button
                onClick={shareOnFacebook}
                disabled={!activeLink}
                className="py-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-2xl transition-all flex flex-col items-center justify-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50"
              >
                <i className="bi bi-facebook text-base leading-none"></i>
                <span>Facebook</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
