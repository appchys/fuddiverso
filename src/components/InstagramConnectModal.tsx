'use client'

import React, { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'

interface InstagramConnectModalProps {
  isOpen: boolean
  businessId?: string
  onClose: () => void
}

export function InstagramConnectModal({
  isOpen,
  businessId,
  onClose,
}: InstagramConnectModalProps) {
  const [status, setStatus] = useState<'connected' | 'disconnected'>('disconnected')
  const [username, setUsername] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [showManualForm, setShowManualForm] = useState(false)
  const [manualToken, setManualToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    if (!businessId) return
    const unsub = onSnapshot(
      doc(db, 'businesses', businessId, 'instagramConnection', 'status'),
      (snap) => {
        if (!snap.exists()) {
          setStatus('disconnected')
          setUsername(null)
          setAccountId(null)
          return
        }
        const data = snap.data() || {}
        setStatus(data.status === 'connected' ? 'connected' : 'disconnected')
        setUsername(data.instagramUsername || null)
        setAccountId(data.instagramAccountId || null)
      },
      () => {}
    )
    return () => unsub()
  }, [businessId])

  if (!isOpen) return null

  const handleOAuthConnect = () => {
    if (!businessId) return
    window.location.href = `/api/instagram/connect?businessId=${encodeURIComponent(businessId)}`
  }

  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId || !manualToken.trim()) return
    setLoading(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/instagram/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          action: 'connect_manual',
          accessToken: manualToken.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setFeedback({ ok: false, msg: data?.error || 'No se pudo conectar Instagram.' })
      } else {
        setFeedback({
          ok: true,
          msg: `Instagram conectado${data.instagramUsername ? ` (@${data.instagramUsername})` : ''}.`,
        })
        setManualToken('')
        setShowManualForm(false)
      }
    } catch {
      setFeedback({ ok: false, msg: 'Error de red conectando Instagram.' })
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!businessId) return
    setLoading(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/instagram/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, action: 'disconnect' }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.ok) {
        setFeedback({ ok: true, msg: 'Instagram desconectado.' })
      } else {
        setFeedback({ ok: false, msg: data?.error || 'No se pudo desconectar.' })
      }
    } catch {
      setFeedback({ ok: false, msg: 'Error de red al desconectar.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-gradient-to-r from-pink-50/80 to-purple-50/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 via-pink-600 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <i className="bi bi-instagram text-base"></i>
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-gray-900 tracking-tight leading-tight">
                Mensajes de Instagram
              </h2>
              <p className="text-[11px] font-medium text-gray-500 truncate">
                Recibe y responde DMs en tu bandeja unificada
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-white/70 inline-flex items-center justify-center cursor-pointer"
            aria-label="Cerrar"
          >
            <i className="bi bi-x-lg text-sm"></i>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {feedback && (
            <div
              className={`p-3 rounded-xl text-xs font-semibold border ${
                feedback.ok
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              {feedback.msg}
            </div>
          )}

          {status === 'connected' ? (
            <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <span className="text-xs font-black text-emerald-800 uppercase tracking-wide">
                    Conectado
                  </span>
                </div>
                {username && (
                  <span className="text-xs font-bold text-slate-700">@{username}</span>
                )}
              </div>
              {accountId && (
                <p className="text-[11px] text-slate-500 font-medium">
                  ID cuenta profesional: <span className="font-mono">{accountId}</span>
                </p>
              )}
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleDisconnect()}
                className="w-full py-2 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                {loading ? 'Desconectando...' : 'Desconectar Instagram'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-medium text-gray-600 leading-relaxed">
                Vincula tu cuenta de <strong>Instagram Profesional</strong> para que los mensajes directos (DMs) lleguen mezclados en tu lista de Mensajes con el ícono de Instagram.
              </p>

              <button
                type="button"
                onClick={handleOAuthConnect}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white text-xs font-bold shadow-sm inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <i className="bi bi-instagram text-sm"></i>
                <span>Conectar con Instagram</span>
              </button>

              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowManualForm((prev) => !prev)}
                  className="text-[11px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  {showManualForm
                    ? 'Ocultar conexión manual con token'
                    : '¿Tienes un Access Token de Meta? Conectar manualmente'}
                </button>

                {showManualForm && (
                  <form onSubmit={handleManualConnect} className="mt-2.5 space-y-2.5">
                    <input
                      type="password"
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      placeholder="Pega aquí tu Instagram Access Token..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-400"
                    />
                    <button
                      type="submit"
                      disabled={loading || !manualToken.trim()}
                      className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                    >
                      {loading ? 'Validando token...' : 'Guardar y conectar'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
