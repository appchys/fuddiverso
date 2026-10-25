'use client'

import React, { useState, useEffect } from 'react'
import { X, Store, ShoppingBag, CircleDollarSign, Wallet, Sparkles, Copy, Check, Share2 } from 'lucide-react'
import { getReferralByCode, getUserCreditsFlexible, getBusiness } from '@/lib/database'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'

interface ReferralCreditRewardModalProps {
  isOpen: boolean
  onClose: () => void
  notification: any | null
  userId?: string
  userPhone?: string
}

export default function ReferralCreditRewardModal({
  isOpen,
  onClose,
  notification,
  userId,
  userPhone
}: ReferralCreditRewardModalProps) {
  const [productName, setProductName] = useState<string>('')
  const [productImage, setProductImage] = useState<string>('')
  const [businessName, setBusinessName] = useState<string>('')
  const [amountEarned, setAmountEarned] = useState<number>(0.25)
  const [accumulatedBalance, setAccumulatedBalance] = useState<number | null>(null)
  const [referralLink, setReferralLink] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [imageError, setImageError] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)
  const [canShare, setCanShare] = useState<boolean>(false)

  // Detectar soporte para compartir nativo (móviles)
  useEffect(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      setCanShare(true)
    }
  }, [])

  // Sincronizar datos iniciales de inmediato en cuanto se abra
  useEffect(() => {
    if (!isOpen || !notification) {
      setImageError(false)
      setCopied(false)
      return
    }

    console.log('🎁 [ReferralCreditRewardModal] Abierto con notificación:', notification)

    let prodName = notification.productName || ''
    let prodImage = notification.productImage || ''
    let bizName = notification.businessName || ''
    const amount = typeof notification.amount === 'number' ? notification.amount : 0.25
    let refUrl = notification.referralLink || ''

    // Si ya viene referralLink completo en la notificación, usarlo
    if (!refUrl && notification.referralCode && notification.businessUsername && notification.productSlug) {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      refUrl = `${origin}/${notification.businessUsername}/${notification.productSlug}?ref=${notification.referralCode}`
    }

    setProductName(prodName)
    setProductImage(prodImage)
    setBusinessName(bizName || 'Tienda')
    setAmountEarned(amount)
    setReferralLink(refUrl)
    setImageError(false)
    setCopied(false)

    let isMounted = true

    const loadData = async () => {
      setIsLoading(true)

      let resolvedCode = notification.referralCode || ''
      let resolvedBizUser = notification.businessUsername || ''
      let resolvedSlug = notification.productSlug || notification.productId || ''

      // 1. Si falta producto, tienda o link, consultar en referralLinks por código
      if (resolvedCode) {
        try {
          const refData = await getReferralByCode(resolvedCode)
          if (refData) {
            if (!prodName && refData.productName) {
              prodName = refData.productName
              if (isMounted) setProductName(prodName)
            }
            if (!prodImage && refData.productImage) {
              prodImage = refData.productImage
              if (isMounted) setProductImage(prodImage)
            }
            if (!bizName && refData.businessName) {
              bizName = refData.businessName
              if (isMounted) setBusinessName(bizName)
            }
            if (!resolvedBizUser && refData.businessUsername) {
              resolvedBizUser = refData.businessUsername
            }
            if (!resolvedSlug && (refData.productSlug || refData.productId)) {
              resolvedSlug = refData.productSlug || refData.productId
            }

            // Si aún falta el username del negocio pero tenemos businessId, consultarlo
            if (!resolvedBizUser && (refData.businessId || notification.businessId)) {
              try {
                const b = await getBusiness(refData.businessId || notification.businessId)
                if (b?.username) {
                  resolvedBizUser = b.username
                  if (!bizName && b.name) {
                    bizName = b.name
                    if (isMounted) setBusinessName(bizName)
                  }
                }
              } catch (bErr) {
                console.warn('[ReferralCreditRewardModal] Error loading business:', bErr)
              }
            }

            // Construir link si no existía
            if (!refUrl && resolvedCode) {
              const origin = typeof window !== 'undefined' ? window.location.origin : ''
              const targetUser = resolvedBizUser || notification.businessId || 'tienda'
              const targetSlug = resolvedSlug || 'producto'
              refUrl = `${origin}/${targetUser}/${targetSlug}?ref=${resolvedCode}`
              if (isMounted) setReferralLink(refUrl)
            }
          }
        } catch (err) {
          console.warn('[ReferralCreditRewardModal] Error loading referral link:', err)
        }
      }

      // 2. Si aún falta información y tenemos orderId, consultar la orden
      if ((!prodName || !prodImage) && notification.orderId) {
        try {
          const orderSnap = await getDoc(doc(db, 'orders', notification.orderId))
          if (orderSnap.exists()) {
            const orderData = orderSnap.data()
            if (!bizName && orderData.businessName) {
              bizName = orderData.businessName
              if (isMounted) setBusinessName(bizName)
            }
            if (Array.isArray(orderData.items) && orderData.items.length > 0) {
              const item = orderData.items[0]
              if (!prodName) {
                prodName = item.name || item.productName || ''
                if (isMounted) setProductName(prodName)
              }
              if (!prodImage) {
                prodImage = item.image || item.productImage || ''
                if (isMounted) setProductImage(prodImage)
              }
            }
          }
        } catch (err) {
          console.warn('[ReferralCreditRewardModal] Error loading order:', err)
        }
      }

      // 3. Obtener saldo acumulado del usuario
      try {
        const identifiers = [userId, userPhone, notification.userId].filter(Boolean) as string[]
        if (identifiers.length > 0) {
          const credits = await getUserCreditsFlexible(identifiers)
          if (isMounted) {
            setAccumulatedBalance(credits.available)
          }
        } else if (isMounted) {
          setAccumulatedBalance(amount)
        }
      } catch (err) {
        console.warn('[ReferralCreditRewardModal] Error loading user credits:', err)
        if (isMounted) {
          setAccumulatedBalance(amount)
        }
      }

      if (isMounted) {
        setIsLoading(false)
      }
    }

    loadData()

    return () => {
      isMounted = false
    }
  }, [isOpen, notification, userId, userPhone])

  const handleCopyLink = async () => {
    if (!referralLink) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(referralLink)
      } else {
        // Fallback para navegadores antiguos
        const input = document.createElement('input')
        input.value = referralLink
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        document.body.removeChild(input)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (err) {
      console.error('Error al copiar link:', err)
    }
  }

  const handleShareLink = async () => {
    if (!referralLink) return
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: productName ? `${productName} en ${businessName}` : 'Recomendación de compra',
          text: `¡Mira este producto en ${businessName}! Te lo recomiendo:`,
          url: referralLink
        })
        return
      } catch (err) {
        // Si el usuario canceló el share dialog no hacemos nada
        if ((err as any)?.name === 'AbortError') return
      }
    }
    // Si falla o no está soportado, copiamos al portapapeles
    handleCopyLink()
  }

  if (!isOpen || !notification) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop con blur */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200">
        {/* Cabecera festiva */}
        <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-700 text-white p-6 pb-7 text-center relative overflow-hidden">
          {/* Círculos decorativos */}
          <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-white/10 blur-xl pointer-events-none" />
          <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full bg-emerald-400/20 blur-lg pointer-events-none" />

          {/* Botón cerrar */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/15 hover:bg-black/25 text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Cerrar"
          >
            <X size={18} />
          </button>

          {/* Icono de recompensa */}
          <div className="w-14 h-14 mx-auto rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-white shadow-inner mb-3.5 border border-white/30">
            <Sparkles size={26} className="text-emerald-200" />
          </div>

          <h3 className="text-xl font-black tracking-tight leading-tight text-white">
            ¡Ganaste crédito por recomendación!
          </h3>
          <p className="text-emerald-100 text-xs font-medium mt-1 leading-relaxed">
            Tu recomendación generó una compra exitosa
          </p>
        </div>

        {/* Cuerpo del modal */}
        <div className="p-5 space-y-3.5 max-h-[80vh] overflow-y-auto">
          {/* Información del producto y tienda */}
          <div className="bg-gray-50/90 rounded-2xl p-3.5 border border-gray-100">
            <div className="flex items-center gap-3">
              {/* Imagen del producto o fallback estilizado */}
              <div className="w-14 h-14 rounded-xl overflow-hidden bg-white border border-gray-200/60 shadow-sm shrink-0 flex items-center justify-center">
                {productImage && !imageError ? (
                  <img
                    src={productImage}
                    alt={productName || 'Producto'}
                    className="w-full h-full object-cover"
                    onError={() => setImageError(true)}
                  />
                ) : (
                  <div className="w-full h-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <ShoppingBag size={22} />
                  </div>
                )}
              </div>

              {/* Textos de tienda y producto */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-black tracking-tight leading-tight mb-1">
                  <Store size={13} className="shrink-0 text-emerald-600" />
                  <span className="truncate">{businessName || 'Tienda aliada'}</span>
                </div>
                <p className="text-sm font-black text-gray-900 tracking-tight leading-tight line-clamp-2">
                  {productName || (isLoading ? 'Cargando producto...' : 'Producto vendido por recomendación')}
                </p>
              </div>
            </div>
          </div>

          {/* Métricas: Valor ganado y Saldo acumulado */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Valor ganado */}
            <div className="bg-emerald-50/70 border border-emerald-100 rounded-2xl p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between text-emerald-700 mb-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider">
                  Valor ganado
                </span>
                <CircleDollarSign size={15} className="text-emerald-600" />
              </div>
              <p className="text-xl font-black text-emerald-600 tracking-tight leading-tight">
                +${amountEarned.toFixed(2)}
              </p>
              <span className="text-[10px] font-medium text-emerald-700/80 mt-1">
                Por esta venta
              </span>
            </div>

            {/* Saldo acumulado */}
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between text-gray-500 mb-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider">
                  Saldo acumulado
                </span>
                <Wallet size={15} className="text-gray-700" />
              </div>
              <p className="text-xl font-black text-gray-900 tracking-tight leading-tight">
                {accumulatedBalance !== null ? `$${accumulatedBalance.toFixed(2)}` : (isLoading ? '...' : `$${amountEarned.toFixed(2)}`)}
              </p>
              <span className="text-[10px] font-medium text-gray-500 mt-1">
                Disponible
              </span>
            </div>
          </div>

          {/* Bloque: Volver a compartir el link existente */}
          {referralLink ? (
            <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-emerald-800">
                  <Share2 size={13} className="text-emerald-600" />
                  <span className="text-[10px] font-black uppercase tracking-wider">
                    Sigue ganando con este producto
                  </span>
                </div>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full">
                  +$0.25 / venta
                </span>
              </div>

              {/* Caja del link con botón Copiar */}
              <div className="flex items-center gap-2 bg-white rounded-xl p-1.5 border border-emerald-200/80 shadow-2xs">
                <div className="flex-1 min-w-0 px-2">
                  <p className="text-xs text-gray-500 font-mono truncate select-all">
                    {referralLink}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-black text-xs transition-all active:scale-95 cursor-pointer shrink-0 ${
                    copied
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                  title="Copiar link"
                >
                  {copied ? (
                    <>
                      <Check size={13} strokeWidth={3} />
                      <span>¡Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={13} />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>

              {/* Botón compartir para móviles */}
              {canShare && (
                <button
                  type="button"
                  onClick={handleShareLink}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs shadow-xs transition-all active:scale-[0.98] cursor-pointer"
                >
                  <Share2 size={14} />
                  <span>Compartir link en WhatsApp / Redes</span>
                </button>
              )}
            </div>
          ) : (
            isLoading && (
              <div className="py-2 text-center text-xs text-gray-400 font-medium">
                Cargando link de recomendación...
              </div>
            )
          )}

          {/* Botón de acción principal */}
          <button
            onClick={onClose}
            className="w-full py-3.5 px-4 bg-gray-900 hover:bg-black text-white rounded-2xl font-black text-sm tracking-tight shadow-md hover:shadow-lg transition-all active:scale-[0.98] cursor-pointer"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  )
}
