'use client'

import React, { useEffect, useState } from 'react'
import { auth } from '@/lib/firebase'
import type {
  AiAgentConfig,
  AiAgentMode,
  AiProviderId,
  AiTone,
  AiTriggerMode,
  AvailableAiProviders,
} from '@/lib/ai-chat-agent'

interface AiAgentConfigModalProps {
  isOpen: boolean
  businessId?: string
  onClose: () => void
  onStatusChange?: (enabled: boolean) => void
}

const DEFAULT_CONFIG: AiAgentConfig = {
  enabled: false,
  mode: 'suggest_only',
  provider: 'auto',
  tone: 'friendly',
  triggerMode: 'always',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  startTime: '09:00',
  endTime: '22:00',
  includeCatalog: true,
  customInstructions: '',
  pauseOnHumanReplyMinutes: 30,
  cooldownSeconds: 6,
  channels: {
    whatsapp: true,
    instagram: true,
  },
}

const DAY_OPTIONS = [
  { value: 1, short: 'L', label: 'Lun' },
  { value: 2, short: 'M', label: 'Mar' },
  { value: 3, short: 'X', label: 'Mié' },
  { value: 4, short: 'J', label: 'Jue' },
  { value: 5, short: 'V', label: 'Vie' },
  { value: 6, short: 'S', label: 'Sáb' },
  { value: 0, short: 'D', label: 'Dom' },
]

const TRIGGER_MODES: Array<{ value: AiTriggerMode; label: string; desc: string; icon: string }> = [
  { value: 'always', label: 'Siempre', desc: '24/7 en cualquier momento', icon: 'bi-stars' },
  { value: 'store_open', label: 'Tienda abierta', desc: 'Solo en horario de atención', icon: 'bi-shop' },
  { value: 'store_closed', label: 'Tienda cerrada', desc: 'Solo cuando el local está cerrado', icon: 'bi-moon-stars' },
  { value: 'schedule', label: 'Horario propio', desc: 'Días y horas personalizados', icon: 'bi-clock-history' },
]

const TONE_OPTIONS: Array<{ value: AiTone; label: string; desc: string }> = [
  { value: 'friendly', label: 'Amigable', desc: 'Cercano y cálido' },
  { value: 'professional', label: 'Profesional', desc: 'Formal y cordial' },
  { value: 'concise', label: 'Breve', desc: 'Directo al grano' },
]

const PAUSE_OPTIONS = [
  { minutes: 0, label: 'No pausar' },
  { minutes: 15, label: '15 minutos' },
  { minutes: 30, label: '30 minutos' },
  { minutes: 60, label: '1 hora' },
  { minutes: 120, label: '2 horas' },
]

const PROVIDER_LABELS: Array<{ id: AiProviderId; label: string; envKey?: string }> = [
  { id: 'auto', label: 'Automático (con respaldo)' },
  { id: 'gemini', label: 'Google Gemini Flash (Gratis)', envKey: 'GEMINI_API_KEY' },
  { id: 'groq', label: 'Groq GPT-OSS 120B (Gratis)', envKey: 'GROQ_API_KEY' },
  { id: 'mistral', label: 'Mistral AI (Gratis)', envKey: 'MISTRAL_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter Free', envKey: 'OPENROUTER_API_KEY' },
  { id: 'moonshot', label: 'Moonshot AI', envKey: 'MOONSHOT_API_KEY' },
]

export function AiAgentConfigModal({
  isOpen,
  businessId,
  onClose,
  onStatusChange,
}: AiAgentConfigModalProps) {
  const [config, setConfig] = useState<AiAgentConfig>(DEFAULT_CONFIG)
  const [availableProviders, setAvailableProviders] = useState<AvailableAiProviders>({
    gemini: false,
    groq: false,
    mistral: false,
    openrouter: false,
    moonshot: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Simulador de prueba
  const [testInput, setTestInput] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ reply: string; provider?: string } | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !businessId) return
    let cancelled = false

    const loadConfig = async () => {
      setLoading(true)
      setErrorMsg(null)
      setSuccessMsg(null)
      setTestResult(null)
      setTestError(null)
      try {
        const idToken = await auth.currentUser?.getIdToken()
        const res = await fetch(`/api/ai-agent/config?businessId=${encodeURIComponent(businessId)}`, {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
          cache: 'no-store',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.error || 'No se pudo cargar la configuración')
        }
        if (!cancelled) {
          if (data?.config) {
            setConfig(data.config)
            onStatusChange?.(Boolean(data.config.enabled))
          }
          if (data?.availableProviders) {
            setAvailableProviders(data.availableProviders)
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setErrorMsg(err?.message || 'Error cargando la configuración del agente de IA.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadConfig()
    return () => {
      cancelled = true
    }
  }, [isOpen, businessId, onStatusChange])

  if (!isOpen) return null

  const hasAnyProvider = Object.values(availableProviders).some(Boolean)

  const toggleDay = (dayVal: number) => {
    setConfig((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(dayVal)
        ? prev.daysOfWeek.length > 1
          ? prev.daysOfWeek.filter((d) => d !== dayVal)
          : prev.daysOfWeek
        : [...prev.daysOfWeek, dayVal],
    }))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId || saving) return
    setSaving(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const idToken = await auth.currentUser?.getIdToken()
      const res = await fetch('/api/ai-agent/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ businessId, config }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'No se pudo guardar la configuración')
      }
      if (data.config) {
        setConfig(data.config)
        onStatusChange?.(Boolean(data.config.enabled))
      }
      setSuccessMsg('Configuración guardada correctamente.')
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error guardando la configuración.')
    } finally {
      setSaving(false)
    }
  }

  const handleRunTest = async () => {
    if (!businessId || testing) return
    const sample = testInput.trim() || 'Hola, ¿están abiertos y qué productos tienen disponibles?'
    setTesting(true)
    setTestError(null)
    setTestResult(null)
    try {
      const idToken = await auth.currentUser?.getIdToken()
      const res = await fetch('/api/ai-agent/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          businessId,
          testMessage: sample,
          chatHistory: [],
          configOverride: config,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'No se pudo generar una respuesta de prueba.')
      }
      setTestResult({ reply: data.reply, provider: data.provider })
    } catch (err: any) {
      setTestError(err?.message || 'Error al probar el agente de IA.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-gradient-to-r from-violet-50/80 via-indigo-50/50 to-slate-50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <i className="bi bi-stars text-base"></i>
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-gray-900 tracking-tight leading-tight truncate">
                Agente de IA para Mensajes
              </h2>
              <p className="text-[11px] font-medium text-gray-500 leading-relaxed truncate">
                Sugiere o responde automáticamente usando el catálogo de tu tienda
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 inline-flex items-center justify-center transition-colors cursor-pointer shrink-0"
            aria-label="Cerrar"
          >
            <i className="bi bi-x-lg text-sm"></i>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {loading ? (
            <div className="py-12 text-center text-xs font-medium text-gray-500">
              Cargando configuración del agente...
            </div>
          ) : (
            <>
              {/* Estado de proveedores configurados */}
              <div
                className={`p-3 rounded-xl border text-xs ${
                  hasAnyProvider
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : 'bg-amber-50/80 border-amber-200 text-amber-900'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-bold flex items-center gap-1.5">
                    <i className={`bi ${hasAnyProvider ? 'bi-check-circle-fill text-emerald-600' : 'bi-exclamation-triangle-fill text-amber-600'}`}></i>
                    {hasAnyProvider ? 'Proveedores de IA detectados' : 'Falta configurar una API Key gratuita'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(['gemini', 'groq', 'mistral', 'openrouter', 'moonshot'] as const).map((p) => {
                    const active = availableProviders[p]
                    return (
                      <span
                        key={p}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          active
                            ? 'bg-white border-emerald-300 text-emerald-700'
                            : 'bg-white/60 border-slate-200 text-slate-400'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        {p.toUpperCase()}
                      </span>
                    )
                  })}
                </div>
                {!hasAnyProvider && (
                  <p className="mt-2 text-[11px] font-medium text-amber-800 leading-relaxed">
                    Agrega <code className="px-1 py-0.5 bg-amber-100 rounded font-mono">GEMINI_API_KEY</code> (Google AI Studio) o{' '}
                    <code className="px-1 py-0.5 bg-amber-100 rounded font-mono">GROQ_API_KEY</code> en tus variables de entorno para activar el agente gratis.
                  </p>
                )}
              </div>

              {errorMsg && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                  {errorMsg}
                </div>
              )}

              {successMsg && (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
                  {successMsg}
                </div>
              )}

              {/* Switch principal */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black text-gray-900 tracking-tight">
                    Activar Agente de IA
                  </p>
                  <p className="text-[11px] font-medium text-gray-500 leading-relaxed">
                    Habilita sugerencias o respuestas automáticas en el chat de tu tienda
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.enabled}
                  onClick={() => setConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                    config.enabled ? 'bg-violet-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                      config.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Modo de operación */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Modo de funcionamiento
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(
                    [
                      {
                        value: 'suggest_only' as AiAgentMode,
                        title: 'Solo sugerencias (Copiloto)',
                        desc: 'Redacta con 1 clic (✨) en el chat web y tú decides si enviarlo.',
                        icon: 'bi-magic',
                      },
                      {
                        value: 'auto_reply' as AiAgentMode,
                        title: 'Respuesta automática',
                        desc: 'Responde solo los mensajes entrantes de clientes en tiempo real.',
                        icon: 'bi-robot',
                      },
                    ]
                  ).map((item) => {
                    const active = config.mode === item.value
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setConfig((prev) => ({ ...prev, mode: item.value }))}
                        className={`text-left p-3 rounded-xl border transition-all cursor-pointer ${
                          active
                            ? 'bg-violet-50 border-violet-400 ring-1 ring-violet-400'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <i className={`bi ${item.icon} text-sm ${active ? 'text-violet-600' : 'text-slate-500'}`}></i>
                          <span className="text-xs font-bold text-gray-900">{item.title}</span>
                        </div>
                        <p className="text-[11px] font-medium text-gray-500 leading-relaxed">
                          {item.desc}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Opciones solo cuando está en modo auto_reply */}
              {config.mode === 'auto_reply' && (
                <div className="space-y-3 p-3.5 rounded-xl border border-violet-200/80 bg-violet-50/30">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      ¿Cuándo responde automáticamente?
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {TRIGGER_MODES.map((opt) => {
                        const active = config.triggerMode === opt.value
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setConfig((prev) => ({ ...prev, triggerMode: opt.value }))}
                            className={`text-left p-2 rounded-xl border transition-all cursor-pointer ${
                              active
                                ? 'bg-white border-violet-400 ring-1 ring-violet-400'
                                : 'bg-white/70 border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <i className={`bi ${opt.icon} text-xs ${active ? 'text-violet-600' : 'text-slate-500'}`}></i>
                              <span className="text-xs font-bold text-gray-900">{opt.label}</span>
                            </div>
                            <p className="text-[10px] font-medium text-gray-500 mt-0.5">{opt.desc}</p>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {config.triggerMode === 'schedule' && (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {DAY_OPTIONS.map((d) => {
                          const selected = config.daysOfWeek.includes(d.value)
                          return (
                            <button
                              key={d.value}
                              type="button"
                              onClick={() => toggleDay(d.value)}
                              className={`w-8 h-8 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                                selected
                                  ? 'bg-violet-600 border-violet-600 text-white'
                                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                              }`}
                              title={d.label}
                            >
                              {d.short}
                            </button>
                          )
                        })}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">Desde</label>
                          <input
                            type="time"
                            value={config.startTime}
                            onChange={(e) => setConfig((prev) => ({ ...prev, startTime: e.target.value }))}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-gray-900"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">Hasta</label>
                          <input
                            type="time"
                            value={config.endTime}
                            onChange={(e) => setConfig((prev) => ({ ...prev, endTime: e.target.value }))}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-gray-900"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Canales activos</label>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
                          <input
                            type="checkbox"
                            checked={config.channels.whatsapp}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                channels: { ...prev.channels, whatsapp: e.target.checked },
                              }))
                            }
                            className="rounded text-violet-600"
                          />
                          <i className="bi bi-whatsapp text-green-600"></i>
                          WhatsApp
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
                          <input
                            type="checkbox"
                            checked={config.channels.instagram}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                channels: { ...prev.channels, instagram: e.target.checked },
                              }))
                            }
                            className="rounded text-violet-600"
                          />
                          <i className="bi bi-instagram text-pink-600"></i>
                          Instagram
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Pausar si responde un humano
                      </label>
                      <select
                        value={config.pauseOnHumanReplyMinutes}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            pauseOnHumanReplyMinutes: Number(e.target.value),
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-gray-900"
                      >
                        {PAUSE_OPTIONS.map((opt) => (
                          <option key={opt.minutes} value={opt.minutes}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Proveedor y Tono */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Motor de IA
                  </label>
                  <select
                    value={config.provider}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, provider: e.target.value as AiProviderId }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400"
                  >
                    {PROVIDER_LABELS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Tono de respuesta
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {TONE_OPTIONS.map((t) => {
                      const active = config.tone === t.value
                      return (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setConfig((prev) => ({ ...prev, tone: t.value }))}
                          className={`py-2 px-1.5 rounded-xl border text-center transition-all cursor-pointer ${
                            active
                              ? 'bg-violet-50 border-violet-400 text-violet-800 font-bold'
                              : 'bg-white border-slate-200 text-slate-600 font-semibold hover:bg-slate-50'
                          }`}
                        >
                          <span className="block text-[11px] leading-tight">{t.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Catálogo */}
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-white cursor-pointer hover:bg-slate-50/70 transition-colors">
                <input
                  type="checkbox"
                  checked={config.includeCatalog}
                  onChange={(e) => setConfig((prev) => ({ ...prev, includeCatalog: e.target.checked }))}
                  className="mt-0.5 rounded text-violet-600"
                />
                <div>
                  <span className="block text-xs font-bold text-gray-900">
                    Usar catálogo real de productos y horarios
                  </span>
                  <span className="block text-[11px] font-medium text-gray-500 leading-relaxed">
                    El agente consultará tus productos disponibles, precios, variantes y si la tienda está abierta.
                  </span>
                </div>
              </label>

              {/* Instrucciones personalizadas */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Instrucciones personalizadas (opcional)
                </label>
                <textarea
                  rows={3}
                  value={config.customInstructions}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, customInstructions: e.target.value }))
                  }
                  placeholder="Ej. Envíos gratis en pedidos mayores a $15. Tiempo de entrega promedio 25-35 min. Si piden factura, solicitar RUC y correo."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 resize-none leading-relaxed"
                />
              </div>

              {/* Simulador de prueba */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-gray-900 tracking-tight flex items-center gap-1.5">
                    <i className="bi bi-chat-square-text text-violet-600"></i>
                    Probar respuesta del agente
                  </span>
                  {testResult?.provider && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                      {testResult.provider}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={testInput}
                    onChange={(e) => setTestInput(e.target.value)}
                    placeholder="Ej. Hola, ¿qué combos tienen hoy?"
                    className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                  />
                  <button
                    type="button"
                    disabled={testing}
                    onClick={() => void handleRunTest()}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer shrink-0"
                  >
                    {testing ? 'Pensando...' : 'Probar'}
                  </button>
                </div>
                {testError && (
                  <p className="text-[11px] font-medium text-rose-600">{testError}</p>
                )}
                {testResult && (
                  <div className="p-2.5 rounded-xl bg-white border border-violet-200 text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {testResult.reply}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Footer actions */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cerrar
            </button>
            <button
              type="submit"
              disabled={saving || loading}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <i className="bi bi-check2-circle"></i>
              <span>{saving ? 'Guardando...' : 'Guardar configuración'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
