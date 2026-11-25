'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { auth } from '@/lib/firebase'
import { Business, Product } from '@/types'
import { getProductPublicPrice, formatPrice } from '@/lib/price-utils'
import type { LinkPreviewData } from '@/lib/link-preview'

interface WhatsAppStatusModalProps {
  isOpen: boolean
  product: Product | null
  business: Business | null
  onClose: () => void
}

const STATUS_BG_OPTIONS = [
  { id: 'slate', label: 'Carbón', hex: '#1E293B' },
  { id: 'emerald', label: 'Bosque', hex: '#0F5132' },
  { id: 'teal', label: 'Petróleo', hex: '#115E59' },
  { id: 'indigo', label: 'Índigo', hex: '#312E81' },
  { id: 'plum', label: 'Ciruela', hex: '#581C87' },
  { id: 'terracotta', label: 'Terracota', hex: '#9A3412' },
] as const

const STATUS_FONT_OPTIONS = [
  { value: 1, label: 'Moderna', className: 'font-sans' },
  { value: 2, label: 'Editorial', className: 'font-serif' },
  { value: 4, label: 'Mono', className: 'font-mono' },
] as const

function buildProductPublicUrl(business: Business | null, product: Product | null): string {
  if (!business?.username || !product) return ''
  const slugOrId = product.slug || product.id
  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase()
    if (host !== 'localhost' && host !== '127.0.0.1' && !host.startsWith('192.168.')) {
      return `${window.location.origin}/${business.username}/${slugOrId}`
    }
  }
  return `https://fuddi.shop/${business.username}/${slugOrId}`
}

function buildFallbackPreview(
  product: Product,
  business: Business | null,
  productUrl: string
): LinkPreviewData {
  const storeName = business?.name || 'fuddi.shop'
  let pricePrefix = ''
  if (product.variants && product.variants.length > 0) {
    const basePrice = getProductPublicPrice(product)
    const displayPrice =
      basePrice > 0
        ? basePrice
        : Math.min(...product.variants.map((v) => getProductPublicPrice(v)))
    pricePrefix = `Desde ${formatPrice(displayPrice)} - `
  } else {
    pricePrefix = `${formatPrice(getProductPublicPrice(product))} - `
  }

  return {
    url: productUrl,
    matchedText: productUrl,
    title: `${product.name} - ${storeName}`,
    description: `${pricePrefix}${product.description || `Descubre ${product.name} en ${storeName}`}`,
    image: product.image || null,
    siteName: 'fuddi.shop',
  }
}

export default function WhatsAppStatusModal({
  isOpen,
  product,
  business,
  onClose,
}: WhatsAppStatusModalProps) {
  const [mounted, setMounted] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [backgroundColor, setBackgroundColor] = useState<string>(STATUS_BG_OPTIONS[0].hex)
  const [font, setFont] = useState<number>(1)

  const [linkPreview, setLinkPreview] = useState<LinkPreviewData | null>(null)
  const [previewSource, setPreviewSource] = useState<'metatags' | 'fallback' | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const [waConnected, setWaConnected] = useState<boolean | null>(null)
  const [waPhone, setWaPhone] = useState<string | null>(null)
  const [checkingConnection, setCheckingConnection] = useState(false)

  const [publishing, setPublishing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successInfo, setSuccessInfo] = useState<{
    recipientsCount: number
    pending?: boolean
  } | null>(null)

  const productUrl = useMemo(
    () => buildProductPublicUrl(business, product),
    [business, product]
  )

  useEffect(() => {
    setMounted(true)
  }, [])

  const loadMetatagsPreview = useCallback(
    async (targetUrl: string, currentProduct: Product | null, currentBusiness: Business | null) => {
      if (!targetUrl) {
        setLinkPreview(null)
        setPreviewSource(null)
        return
      }
      setLoadingPreview(true)
      try {
        const res = await fetch(
          `/api/whatsapp/link-preview?url=${encodeURIComponent(targetUrl)}`,
          { cache: 'no-store' }
        )
        const data = await res.json().catch(() => null)
        if (data?.preview && data.preview.url) {
          setLinkPreview({
            ...data.preview,
            matchedText: targetUrl,
          })
          setPreviewSource('metatags')
        } else if (currentProduct) {
          setLinkPreview(buildFallbackPreview(currentProduct, currentBusiness, targetUrl))
          setPreviewSource('fallback')
        } else {
          setLinkPreview(null)
          setPreviewSource(null)
        }
      } catch {
        if (currentProduct) {
          setLinkPreview(buildFallbackPreview(currentProduct, currentBusiness, targetUrl))
          setPreviewSource('fallback')
        } else {
          setLinkPreview(null)
          setPreviewSource(null)
        }
      } finally {
        setLoadingPreview(false)
      }
    },
    []
  )

  // Inicializar estado del modal al abrirse con un producto
  useEffect(() => {
    if (!isOpen || !product || !business) return

    let cancelled = false
    setErrorMsg(null)
    setSuccessInfo(null)

    const priceLabel =
      product.variants && product.variants.length > 0
        ? (() => {
            const base = getProductPublicPrice(product)
            const val =
              base > 0
                ? base
                : Math.min(...product.variants.map((v) => getProductPublicPrice(v)))
            return `Desde ${formatPrice(val)}`
          })()
        : formatPrice(getProductPublicPrice(product))

    setStatusText(`✨ ${product.name} (${priceLabel})\nPídelo aquí 👇\n${productUrl}`)
    setBackgroundColor(STATUS_BG_OPTIONS[0].hex)
    setFont(1)

    void loadMetatagsPreview(productUrl, product, business)

    // Verificar conexión de WhatsApp de la tienda
    ;(async () => {
      setCheckingConnection(true)
      try {
        const idToken = await auth.currentUser?.getIdToken()
        const res = await fetch(
          `/api/whatsapp/bridge?businessId=${encodeURIComponent(business.id)}`,
          {
            cache: 'no-store',
            headers: {
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
          }
        )
        if (!cancelled && res.ok) {
          const data = await res.json()
          setWaConnected(data?.status === 'connected')
          setWaPhone(data?.connectedPhone || null)
        }
      } catch {
        if (!cancelled) {
          setWaConnected(null)
        }
      } finally {
        if (!cancelled) {
          setCheckingConnection(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isOpen, product, business, productUrl, loadMetatagsPreview])

  const handlePublish = async () => {
    if (!business?.id || !product) return
    const trimmed = statusText.trim()
    if (!trimmed) {
      setErrorMsg('Escribe un texto o enlace para publicar en el estado.')
      return
    }

    setPublishing(true)
    setErrorMsg(null)
    setSuccessInfo(null)

    try {
      const idToken = await auth.currentUser?.getIdToken()
      const res = await fetch('/api/whatsapp/bridge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          action: 'publish-status',
          businessId: business.id,
          text: trimmed,
          url: productUrl,
          linkPreview: linkPreview || undefined,
          backgroundColor,
          font,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setErrorMsg(data?.error || 'No se pudo publicar el estado en WhatsApp.')
        return
      }

      setSuccessInfo({
        recipientsCount: Number(data?.recipientsCount || 0),
        pending: Boolean(data?.pending),
      })
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error de red al publicar el estado en WhatsApp.')
    } finally {
      setPublishing(false)
    }
  }

  if (!mounted || !isOpen || !product || !business) return null

  const activeFontClass =
    STATUS_FONT_OPTIONS.find((f) => f.value === font)?.className || 'font-sans'

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-gray-100 max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-emerald-50/80 to-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <i className="bi bi-whatsapp text-xl"></i>
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-black text-gray-900 tracking-tight leading-tight truncate">
                Publicar como estado de WhatsApp
              </h3>
              <p className="text-xs font-medium text-gray-500 leading-relaxed truncate">
                {product.name}
                {waPhone ? ` · Conectado (${waPhone})` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="Cerrar"
          >
            <i className="bi bi-x-lg text-sm"></i>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Columna izquierda: Vista previa estilo Estado de WhatsApp */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Vista previa del estado
              </span>
              <button
                type="button"
                disabled={loadingPreview}
                onClick={() => void loadMetatagsPreview(productUrl, product, business)}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1.5 disabled:opacity-50"
              >
                <i className={`bi bi-arrow-clockwise ${loadingPreview ? 'animate-spin' : ''}`}></i>
                {loadingPreview ? 'Cargando...' : 'Recargar metatags'}
              </button>
            </div>

            <div
              className="rounded-2xl p-5 min-h-[320px] flex flex-col justify-center items-center text-center shadow-inner relative overflow-hidden transition-colors duration-200"
              style={{ backgroundColor }}
            >
              {/* Barra superior simulada de estado */}
              <div className="absolute top-3 left-3 right-3 flex items-center gap-2">
                <div className="h-1 flex-1 rounded-full bg-white/80"></div>
              </div>

              {/* Tarjeta de vista previa OpenGraph (metatags) */}
              <div className="w-full max-w-[270px] mt-4">
                {loadingPreview ? (
                  <div className="rounded-xl bg-black/25 backdrop-blur-sm p-4 text-white/90 flex flex-col items-center gap-2 border border-white/15">
                    <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                    <span className="text-xs font-medium">
                      Cargando vista previa de metatags...
                    </span>
                  </div>
                ) : linkPreview ? (
                  <div className="rounded-xl overflow-hidden bg-white text-left shadow-lg border border-black/10">
                    {linkPreview.image && (
                      <div className="w-full h-32 bg-gray-100 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={linkPreview.image}
                          alt={linkPreview.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 truncate">
                        {linkPreview.siteName || 'fuddi.shop'}
                      </p>
                      <p className="text-xs font-black text-gray-900 tracking-tight leading-tight line-clamp-2 mt-0.5">
                        {linkPreview.title}
                      </p>
                      {linkPreview.description && (
                        <p className="text-[11px] font-medium text-gray-500 leading-snug line-clamp-2 mt-1">
                          {linkPreview.description}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-black/20 p-3 text-white/80 text-xs border border-white/10">
                    Sin vista previa de metatags disponible
                  </div>
                )}

                {/* Texto del estado */}
                <p
                  className={`mt-4 text-white text-sm leading-relaxed whitespace-pre-wrap break-words ${activeFontClass}`}
                >
                  {statusText || productUrl}
                </p>
              </div>
            </div>

            {previewSource && !loadingPreview && (
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                <i
                  className={`bi ${
                    previewSource === 'metatags'
                      ? 'bi-check-circle-fill text-emerald-600'
                      : 'bi-info-circle-fill text-amber-500'
                  }`}
                ></i>
                {previewSource === 'metatags'
                  ? 'Vista previa cargada desde los metatags OpenGraph del producto.'
                  : 'Vista previa generada con los datos actuales del producto.'}
              </div>
            )}
          </div>

          {/* Columna derecha: Configuración del estado */}
          <div className="flex flex-col gap-4">
            {/* Aviso de estado de conexión */}
            {checkingConnection ? (
              <div className="rounded-xl bg-gray-50 border border-gray-200 px-3.5 py-2.5 text-xs text-gray-600 flex items-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-emerald-600 rounded-full animate-spin"></div>
                Verificando conexión de WhatsApp de la tienda...
              </div>
            ) : waConnected === false ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-800 flex items-start gap-2">
                <i className="bi bi-exclamation-triangle-fill text-amber-600 mt-0.5"></i>
                <span>
                  El WhatsApp de la tienda no está conectado. Vincula tu cuenta en el panel de
                  WhatsApp antes de publicar.
                </span>
              </div>
            ) : null}

            {/* Enlace del producto */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Enlace del producto
              </label>
              <div className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-600 font-mono truncate">
                {productUrl}
              </div>
            </div>

            {/* Texto del estado */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="wa-status-text"
                  className="text-xs font-bold text-gray-700"
                >
                  Texto del estado
                </label>
                <span className="text-[11px] text-gray-400">
                  {statusText.length}/700
                </span>
              </div>
              <textarea
                id="wa-status-text"
                rows={4}
                maxLength={700}
                value={statusText}
                onChange={(e) => setStatusText(e.target.value)}
                placeholder="Escribe el texto que acompañará al enlace..."
                className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 resize-none"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Mantén el enlace en el texto para que WhatsApp muestre la tarjeta clicable.
              </p>
            </div>

            {/* Selector de color de fondo */}
            <div>
              <span className="block text-xs font-bold text-gray-700 mb-2">
                Color de fondo
              </span>
              <div className="flex items-center gap-2.5 flex-wrap">
                {STATUS_BG_OPTIONS.map((opt) => {
                  const isSelected = backgroundColor === opt.hex
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setBackgroundColor(opt.hex)}
                      title={opt.label}
                      className={`w-8 h-8 rounded-full transition-transform flex items-center justify-center ${
                        isSelected
                          ? 'ring-2 ring-offset-2 ring-emerald-600 scale-110'
                          : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: opt.hex }}
                    >
                      {isSelected && <i className="bi bi-check-lg text-white text-sm"></i>}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Selector de tipografía */}
            <div>
              <span className="block text-xs font-bold text-gray-700 mb-2">
                Estilo de letra
              </span>
              <div className="grid grid-cols-3 gap-2">
                {STATUS_FONT_OPTIONS.map((opt) => {
                  const isSelected = font === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFont(opt.value)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${opt.className} ${
                        isSelected
                          ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Mensajes de error / éxito */}
            {errorMsg && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-700 font-medium flex items-start gap-2">
                <i className="bi bi-x-circle-fill text-red-600 mt-0.5"></i>
                <span>{errorMsg}</span>
              </div>
            )}

            {successInfo && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-3 text-xs text-emerald-800 font-medium flex items-start gap-2">
                <i className="bi bi-check-circle-fill text-emerald-600 text-sm mt-0.5"></i>
                <div>
                  <p className="font-bold">
                    {successInfo.pending
                      ? '¡Estado en proceso de publicación!'
                      : '¡Estado publicado en WhatsApp!'}
                  </p>
                  <p className="text-emerald-700 mt-0.5">
                    {successInfo.pending
                      ? `Se está enviando a ${successInfo.recipientsCount} ${
                          successInfo.recipientsCount === 1 ? 'contacto' : 'contactos'
                        } en segundo plano. Aparecerá en tus estados de WhatsApp en unos momentos.`
                      : `Enviado a ${successInfo.recipientsCount} ${
                          successInfo.recipientsCount === 1 ? 'contacto' : 'contactos'
                        } (quienes tengan guardado el número de tu tienda podrán verlo).`}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/70 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-200/70 transition-colors"
          >
            {successInfo ? 'Cerrar' : 'Cancelar'}
          </button>
          <button
            type="button"
            disabled={publishing || loadingPreview || waConnected === false || !statusText.trim()}
            onClick={handlePublish}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-2 transition-colors"
          >
            {publishing ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                Publicando...
              </>
            ) : (
              <>
                <i className="bi bi-whatsapp"></i>
                Publicar como estado
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
