'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export type BaileysStatus = 'disconnected' | 'connecting' | 'qr' | 'connected'

export interface BaileysConnectionInfo {
  status: BaileysStatus
  qrDataUrl: string | null
  pairingCode: string | null
  connectedPhone: string | null
  connectedName: string | null
  lastError: string | null
  updatedAtMillis?: number
}

interface WhatsAppBaileysModalProps {
  isOpen: boolean
  businessId?: string
  onClose: () => void
  onStatusChange?: (status: BaileysStatus) => void
}

export function WhatsAppBaileysModal({
  isOpen,
  businessId,
  onClose,
  onStatusChange,
}: WhatsAppBaileysModalProps) {
  const [info, setInfo] = useState<BaileysConnectionInfo>({
    status: 'disconnected',
    qrDataUrl: null,
    pairingCode: null,
    connectedPhone: null,
    connectedName: null,
    lastError: null,
  })
  const [loadingAction, setLoadingAction] = useState(false)
  const [linkMode, setLinkMode] = useState<'qr' | 'phone'>('qr')
  const [pairingPhoneInput, setPairingPhoneInput] = useState('')
  const [copiedCode, setCopiedCode] = useState(false)

  const applyApiData = useCallback(
    (data: any) => {
      if (!data || !data.status) return
      setInfo({
        status: data.status,
        qrDataUrl: data.qrDataUrl || null,
        pairingCode: data.pairingCode || null,
        connectedPhone: data.connectedPhone || null,
        connectedName: data.connectedName || null,
        lastError: data.lastError || null,
        updatedAtMillis: data.updatedAtMillis,
      })
      onStatusChange?.(data.status)
    },
    [onStatusChange]
  )

  // Escuchar cambios en tiempo real desde Firestore
  useEffect(() => {
    if (!businessId) return
    const unsub = onSnapshot(
      doc(db, 'businesses', businessId, 'whatsappConnection', 'status'),
      (snap) => {
        if (!snap.exists()) return
        const data = snap.data() || {}
        const status: BaileysStatus =
          data.status === 'connected' || data.status === 'qr' || data.status === 'connecting'
            ? data.status
            : 'disconnected'
        setInfo({
          status,
          qrDataUrl: data.qrDataUrl || null,
          pairingCode: data.pairingCode || null,
          connectedPhone: data.connectedPhone || null,
          connectedName: data.connectedName || null,
          lastError: data.lastError || null,
          updatedAtMillis: data.updatedAtMillis,
        })
        onStatusChange?.(status)
      },
      () => {}
    )
    return () => unsub()
  }, [businessId, onStatusChange])

  // Mantener vivo el socket en Vercel únicamente mientras el modal está abierto esperando QR o código de vinculación
  useEffect(() => {
    if (!isOpen || !businessId) return
    if (info.status !== 'qr' && info.status !== 'connecting') return
    let cancelled = false

    const pollLoop = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(
            `/api/whatsapp/bridge?businessId=${encodeURIComponent(businessId)}&hold=true`,
            { cache: 'no-store' }
          )
          if (res.ok && !cancelled) {
            const data = await res.json()
            applyApiData(data)
            if (data?.status === 'connected' || data?.status === 'disconnected') {
              break
            }
          } else {
            await new Promise((r) => setTimeout(r, 3000))
          }
        } catch {
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
    }

    void pollLoop()
    return () => {
      cancelled = true
    }
  }, [isOpen, businessId, info.status, applyApiData])

  const handleConnect = async (usePhoneCode = false) => {
    if (!businessId || loadingAction) return
    if (usePhoneCode && pairingPhoneInput.replace(/\D/g, '').length < 9) {
      setInfo((prev) => ({
        ...prev,
        lastError: 'Ingresa tu número de WhatsApp Business (ej. 0991234567)',
      }))
      return
    }
    setLoadingAction(true)
    try {
      const res = await fetch('/api/whatsapp/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: usePhoneCode ? 'pair-code' : 'connect',
          businessId,
          pairingPhone: usePhoneCode ? pairingPhoneInput.trim() : undefined,
        }),
      })
      const data = await res.json()
      if (data?.error) {
        setInfo((prev) => ({ ...prev, lastError: data.error }))
      } else {
        applyApiData(data)
      }
    } catch (err: any) {
      setInfo((prev) => ({
        ...prev,
        lastError: err?.message || 'No se pudo iniciar la vinculación',
      }))
    } finally {
      setLoadingAction(false)
    }
  }

  const handleDisconnect = async () => {
    if (!businessId || loadingAction) return
    setLoadingAction(true)
    try {
      const res = await fetch('/api/whatsapp/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect', businessId, logout: true }),
      })
      const data = await res.json()
      applyApiData(data)
    } finally {
      setLoadingAction(false)
    }
  }

  if (!isOpen) return null

  const formattedPairingCode = info.pairingCode
    ? info.pairingCode.length === 8
      ? `${info.pairingCode.slice(0, 4)}-${info.pairingCode.slice(4)}`
      : info.pairingCode
    : null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-green-50 text-green-600 flex items-center justify-center">
              <i className="bi bi-whatsapp text-lg"></i>
            </div>
            <div>
              <h3 className="text-sm font-black text-gray-900 tracking-tight leading-tight">
                Dispositivo vinculado de WhatsApp
              </h3>
              <p className="text-[11px] text-gray-500 font-medium">
                Recibe y responde mensajes directo desde Fuddi
              </p>
            </div>
          </div>
          <button
            type="button"
            style={{ minHeight: 0, minWidth: 0 }}
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 inline-flex items-center justify-center cursor-pointer"
          >
            <i className="bi bi-x-lg text-xs"></i>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {info.status === 'connected' ? (
            <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <i className="bi bi-check2-all text-lg"></i>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-emerald-950 uppercase tracking-wide">
                    WhatsApp conectado
                  </p>
                  <p className="text-sm font-black text-gray-900 truncate">
                    {info.connectedName || 'Tienda vinculada'}
                    {info.connectedPhone ? ` · ${info.connectedPhone}` : ''}
                  </p>
                </div>
              </div>
              <p className="text-xs text-emerald-900/80 leading-relaxed">
                Los mensajes entrantes aparecen automáticamente en <strong>Clientes comprando ahora</strong> y puedes responder desde el chat.
              </p>
              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  style={{ minHeight: 0 }}
                  disabled={loadingAction}
                  onClick={() => void handleDisconnect()}
                  className="h-8 px-3 rounded-lg bg-white hover:bg-red-50 text-red-600 border border-red-200 text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <i className="bi bi-box-arrow-right"></i>
                  Desvincular dispositivo
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              {/* Selector: QR (otra pantalla) vs Código por número (mismo celular) */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  style={{ minHeight: 0 }}
                  onClick={() => setLinkMode('qr')}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    linkMode === 'qr'
                      ? 'bg-white text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <i className="bi bi-qr-code mr-1.5"></i>
                  Código QR
                </button>
                <button
                  type="button"
                  style={{ minHeight: 0 }}
                  onClick={() => setLinkMode('phone')}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    linkMode === 'phone'
                      ? 'bg-white text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <i className="bi bi-phone mr-1.5"></i>
                  Desde este celular
                </button>
              </div>

              {linkMode === 'phone' ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Si estás abriendo Fuddi en el <strong>mismo teléfono</strong> donde tienes WhatsApp Business, genera un código de 8 dígitos e ingrésalo en{' '}
                    <strong>Dispositivos vinculados → Vincular con el número de teléfono</strong>.
                  </p>

                  <div className="flex items-center gap-2">
                    <input
                      type="tel"
                      value={pairingPhoneInput}
                      onChange={(e) => setPairingPhoneInput(e.target.value)}
                      placeholder="Tu celular de WhatsApp (ej. 0991234567)"
                      className="flex-1 h-10 px-3 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500/30"
                    />
                    <button
                      type="button"
                      style={{ minHeight: 0 }}
                      disabled={loadingAction}
                      onClick={() => void handleConnect(true)}
                      className="h-10 px-4 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer"
                    >
                      {loadingAction ? 'Generando...' : 'Obtener código'}
                    </button>
                  </div>

                  {formattedPairingCode && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center space-y-2">
                      <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">
                        Código de vinculación
                      </p>
                      <p className="text-2xl font-black tracking-widest text-gray-900 font-mono">
                        {formattedPairingCode}
                      </p>
                      <button
                        type="button"
                        style={{ minHeight: 0 }}
                        onClick={() => {
                          if (info.pairingCode) {
                            void navigator.clipboard?.writeText(info.pairingCode)
                            setCopiedCode(true)
                            setTimeout(() => setCopiedCode(false), 2000)
                          }
                        }}
                        className="h-7 px-3 rounded-lg bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <i className={`bi ${copiedCode ? 'bi-check2' : 'bi-clipboard'}`}></i>
                        <span>{copiedCode ? 'Copiado' : 'Copiar código'}</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : info.status === 'qr' && info.qrDataUrl ? (
                <div className="flex flex-col items-center text-center space-y-3">
                  <div className="p-3 bg-white border-2 border-green-500/30 rounded-2xl shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={info.qrDataUrl}
                      alt="Código QR de WhatsApp"
                      className="w-56 h-56 object-contain"
                    />
                  </div>
                  <div className="space-y-1 text-xs text-gray-600 max-w-xs">
                    <p className="font-bold text-gray-900">
                      Escanea este código desde WhatsApp Business
                    </p>
                    <p className="leading-relaxed">
                      Abre WhatsApp Business en tu teléfono → <strong>Dispositivos vinculados</strong> → <strong>Vincular un dispositivo</strong>.
                    </p>
                  </div>
                </div>
              ) : info.status === 'connecting' || loadingAction ? (
                <div className="py-8 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="w-8 h-8 border-3 border-green-600/30 border-t-green-600 rounded-full animate-spin"></div>
                  <p className="text-xs font-bold text-gray-700">
                    Generando código QR de vinculación...
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs text-slate-600 space-y-1.5 leading-relaxed">
                    <p className="font-bold text-slate-900">
                      ¿Cómo funciona el modo Dispositivo Vinculado?
                    </p>
                    <p>
                      Vincula Fuddi como un dispositivo adicional de tu cuenta de WhatsApp Business (igual que WhatsApp Web).
                    </p>
                  </div>

                  <button
                    type="button"
                    style={{ minHeight: 0 }}
                    disabled={loadingAction}
                    onClick={() => void handleConnect(false)}
                    className="w-full h-10 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
                  >
                    <i className="bi bi-qr-code-scan text-sm"></i>
                    <span>Generar código QR para vincular</span>
                  </button>
                </div>
              )}

              {info.lastError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {info.lastError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
