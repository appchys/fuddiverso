'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export type BaileysStatus = 'disconnected' | 'connecting' | 'qr' | 'connected'

export interface BaileysConnectionInfo {
  status: BaileysStatus
  qrDataUrl: string | null
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
    connectedPhone: null,
    connectedName: null,
    lastError: null,
  })
  const [loadingAction, setLoadingAction] = useState(false)

  const fetchStatusFromApi = useCallback(async () => {
    if (!businessId) return
    try {
      const res = await fetch(`/api/whatsapp/bridge?businessId=${encodeURIComponent(businessId)}`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = await res.json()
      if (data && data.status) {
        setInfo({
          status: data.status,
          qrDataUrl: data.qrDataUrl || null,
          connectedPhone: data.connectedPhone || null,
          connectedName: data.connectedName || null,
          lastError: data.lastError || null,
          updatedAtMillis: data.updatedAtMillis,
        })
        onStatusChange?.(data.status)
      }
    } catch {
      // Ignorar errores de red temporales
    }
  }, [businessId, onStatusChange])

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

  // Consultar la API al abrir el modal y hacer polling ligero mientras genera el QR
  useEffect(() => {
    if (!businessId) return
    void fetchStatusFromApi()
    if (!isOpen) return
    const timer = setInterval(() => {
      void fetchStatusFromApi()
    }, 2500)
    return () => clearInterval(timer)
  }, [isOpen, businessId, fetchStatusFromApi])

  const handleConnect = async () => {
    if (!businessId || loadingAction) return
    setLoadingAction(true)
    try {
      const res = await fetch('/api/whatsapp/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect', businessId }),
      })
      const data = await res.json()
      if (data && data.status) {
        setInfo({
          status: data.status,
          qrDataUrl: data.qrDataUrl || null,
          connectedPhone: data.connectedPhone || null,
          connectedName: data.connectedName || null,
          lastError: data.lastError || null,
        })
        onStatusChange?.(data.status)
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
      if (data && data.status) {
        setInfo({
          status: data.status,
          qrDataUrl: null,
          connectedPhone: null,
          connectedName: null,
          lastError: null,
        })
        onStatusChange?.(data.status)
      }
    } finally {
      setLoadingAction(false)
    }
  }

  if (!isOpen) return null

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
                Los mensajes entrantes aparecen automáticamente en <strong>Clientes comprando ahora</strong> y puedes responder desde el chat incluso si tu teléfono está bloqueado o sin notificaciones activas.
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
          ) : info.status === 'qr' && info.qrDataUrl ? (
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="p-3 bg-white border-2 border-green-500/30 rounded-2xl shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={info.qrDataUrl}
                  alt="Código QR de WhatsApp"
                  className="w-60 h-60 object-contain"
                />
              </div>
              <div className="space-y-1 text-xs text-gray-600 max-w-xs">
                <p className="font-bold text-gray-900">
                  Escanea este código desde WhatsApp Business
                </p>
                <p className="leading-relaxed">
                  Abre WhatsApp Business en tu teléfono → <strong>Menú (⋮)</strong> →{' '}
                  <strong>Dispositivos vinculados</strong> → <strong>Vincular un dispositivo</strong>.
                </p>
              </div>
            </div>
          ) : info.status === 'connecting' ? (
            <div className="py-10 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-8 h-8 border-3 border-green-600/30 border-t-green-600 rounded-full animate-spin"></div>
              <p className="text-xs font-bold text-gray-700">
                Preparando código QR de vinculación...
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs text-slate-600 space-y-1.5 leading-relaxed">
                <p className="font-bold text-slate-900">
                  ¿Cómo funciona el modo Dispositivo Vinculado?
                </p>
                <p>
                  Vincula Fuddi como un dispositivo adicional de tu cuenta de WhatsApp Business (igual que WhatsApp Web). Así podrás recibir mensajes, ubicaciones y responder directamente desde el panel sin depender de las notificaciones del celular.
                </p>
              </div>

              {info.lastError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {info.lastError}
                </p>
              )}

              <button
                type="button"
                style={{ minHeight: 0 }}
                disabled={loadingAction}
                onClick={() => void handleConnect()}
                className="w-full h-10 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
              >
                <i className="bi bi-qr-code-scan text-sm"></i>
                <span>{loadingAction ? 'Iniciando...' : 'Generar código QR para vincular'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
