'use client'

import React, { useCallback, useEffect, useState } from 'react'
import type {
  AiAgentGlobalConfig,
  AiDailyUsageSummary,
  AiProviderUsageItem,
  AvailableAiProviders,
} from '@/lib/ai-chat-agent'

function CircularQuotaRing({ item }: { item: AiProviderUsageItem }) {
  const size = 78
  const strokeWidth = 7
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const pct = item.configured ? item.remainingPercent : 0
  const dashOffset = circumference - (pct / 100) * circumference

  const strokeColor = !item.configured
    ? '#cbd5e1'
    : pct > 40
    ? '#7c3aed'
    : pct > 15
    ? '#f59e0b'
    : '#e11d48'

  return (
    <div
      className="p-3.5 rounded-2xl border bg-white border-slate-200 shadow-2xs flex flex-col items-center text-center gap-2 min-w-[150px] shrink-0 transition-all"
    >
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-black text-gray-900 leading-none">
            {item.configured ? `${pct}%` : '—'}
          </span>
          <span className="text-[9px] font-semibold text-gray-400 mt-0.5">
            {item.configured ? 'restante' : 'inactivo'}
          </span>
        </div>
      </div>

      <div className="min-w-0 w-full space-y-0.5">
        <p className="text-xs font-black text-gray-900 tracking-tight truncate">{item.label}</p>
        <p className="text-[10px] font-medium text-gray-500 truncate" title={item.model}>
          {item.model}
        </p>
        {item.configured ? (
          <p className="text-[10px] font-bold text-slate-600 pt-0.5">
            {item.usedToday.toLocaleString('es-EC')} / {item.dailyLimit.toLocaleString('es-EC')} hoy
          </p>
        ) : (
          <p className="text-[10px] font-medium text-slate-400 pt-0.5">Sin API key</p>
        )}
        {item.rateLimitedToday > 0 && (
          <span className="inline-block mt-1 px-1.5 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-[9px] font-bold text-rose-600">
            {item.rateLimitedToday} límite(s) 429 hoy
          </span>
        )}
      </div>
    </div>
  )
}

const DYNAMIC_CONTEXT_ITEMS = [
  { icon: 'bi-clock-history', title: 'Fecha, hora y próxima apertura', desc: 'Hora exacta de Ecuador, si la tienda está abierta o cerrada y cuándo vuelve a abrir.' },
  { icon: 'bi-bag-heart', title: 'Catálogo real de productos', desc: 'Productos activos, precios, variantes y descripciones de cada tienda.' },
  { icon: 'bi-bank', title: 'Cuentas para transferencia', desc: 'Cuentas propias de la tienda o cuentas oficiales de Fuddi según su configuración.' },
  { icon: 'bi-geo-alt', title: 'Ubicación, pickup y zonas de envío', desc: 'Dirección, Google Maps del local y tarifas de envío personalizadas por zona.' },
  { icon: 'bi-person-vcard', title: 'Identificación del cliente', desc: 'Nombre registrado, celular y ubicaciones guardadas del cliente con su tarifa real.' },
  { icon: 'bi-image', title: 'Lectura de imágenes', desc: 'Analiza comprobantes de pago, capturas de productos o mapas enviados en el chat.' },
]

export default function AdminAiAgentPage() {
  const [config, setConfig] = useState<AiAgentGlobalConfig>({
    baseRules: '',
    extraGlobalInstructions: '',
  })
  const [defaultBaseRules, setDefaultBaseRules] = useState('')
  const [availableProviders, setAvailableProviders] = useState<AvailableAiProviders>({
    gemini: false,
    groq: false,
    mistral: false,
    openrouter: false,
    moonshot: false,
  })
  const [usageSummary, setUsageSummary] = useState<AiDailyUsageSummary | null>(null)
  const [refreshingUsage, setRefreshingUsage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const loadAll = useCallback(async (onlyRefreshUsage = false) => {
    if (onlyRefreshUsage) {
      setRefreshingUsage(true)
    } else {
      setLoading(true)
      setErrorMsg(null)
    }
    try {
      const res = await fetch('/api/ai-agent/global-config', {
        headers: { 'x-fuddi-admin': 'authenticated' },
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'No se pudo cargar la configuración global')
      }
      if (!onlyRefreshUsage) {
        setConfig(data.config)
        setDefaultBaseRules(String(data.defaultBaseRules || ''))
      }
      if (data.availableProviders) setAvailableProviders(data.availableProviders)
      if (data.usageSummary) setUsageSummary(data.usageSummary)
    } catch (err: any) {
      if (!onlyRefreshUsage) {
        setErrorMsg(err?.message || 'Error cargando configuración global del Agente de IA.')
      }
    } finally {
      if (onlyRefreshUsage) {
        setRefreshingUsage(false)
      } else {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadAll(false)
  }, [loadAll])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const res = await fetch('/api/ai-agent/global-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-fuddi-admin': 'authenticated',
        },
        body: JSON.stringify({ config }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'No se pudo guardar la configuración')
      }
      setConfig(data.config)
      setSuccessMsg('Instrucciones globales guardadas. Aplican en menos de 1 minuto a todas las tiendas.')
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error guardando configuración.')
    } finally {
      setSaving(false)
    }
  }

  const handleResetDefaults = () => {
    if (!defaultBaseRules) return
    if (!window.confirm('¿Restaurar las reglas base globales a los valores por defecto?')) return
    setConfig((prev) => ({ ...prev, baseRules: defaultBaseRules }))
    setSuccessMsg(null)
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-violet-600 text-white flex items-center justify-center shadow-md shadow-violet-600/20 shrink-0">
            <i className="bi bi-stars text-xl"></i>
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight leading-tight">
              Agente de IA Global
            </h1>
            <p className="text-xs sm:text-sm font-medium text-gray-500 leading-relaxed">
              Configura las reglas e instrucciones generales que comparten todas las tiendas en Fuddi
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(['gemini', 'groq', 'mistral', 'openrouter', 'moonshot'] as const).map((p) => {
            const active = availableProviders[p]
            return (
              <span
                key={p}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                  active
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-slate-50 border-slate-200 text-slate-400'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                {p.toUpperCase()}
              </span>
            )
          })}
        </div>
      </div>

      {/* Cuota diaria restante por modelo (barras circulares) */}
      {usageSummary && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black text-gray-900 tracking-tight leading-tight flex items-center gap-2">
                <i className="bi bi-speedometer2 text-violet-600"></i>
                <span>Uso restante diario por modelo</span>
              </h2>
              <p className="text-[11px] font-medium text-gray-500 leading-relaxed mt-0.5">
                Día {usageSummary.dateKey} · {usageSummary.totalRequestsToday.toLocaleString('es-EC')} respuestas generadas hoy (estimación respecto a cuotas diarias gratuitas)
              </p>
            </div>
            <button
              type="button"
              disabled={refreshingUsage}
              onClick={() => void loadAll(true)}
              className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-600 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
            >
              <i className={`bi bi-arrow-clockwise ${refreshingUsage ? 'animate-spin' : ''}`}></i>
              <span>Actualizar</span>
            </button>
          </div>
          <div className="flex flex-nowrap items-stretch gap-3 overflow-x-auto pb-1">
            {usageSummary.providers
              .filter((item) => item.configured)
              .map((item) => (
                <CircularQuotaRing key={item.provider} item={item} />
              ))}
            {usageSummary.providers.every((item) => !item.configured) && (
              <p className="text-xs font-medium text-gray-500 py-2">
                No hay ningún modelo de IA conectado en este momento.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Resumen de datos automáticos */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-3">
        <div className="flex items-center gap-2">
          <i className="bi bi-database-check text-violet-600 text-base"></i>
          <h2 className="text-sm font-black text-gray-900 tracking-tight leading-tight">
            Datos que el sistema inyecta automáticamente en cada chat
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {DYNAMIC_CONTEXT_ITEMS.map((item) => (
            <div
              key={item.title}
              className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70 space-y-1"
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900">
                <i className={`bi ${item.icon} text-violet-600`}></i>
                <span>{item.title}</span>
              </div>
              <p className="text-[11px] font-medium text-gray-500 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Formulario de instrucciones globales */}
      <form
        onSubmit={handleSave}
        className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-2xs space-y-5"
      >
        {loading ? (
          <div className="py-12 text-center text-xs font-medium text-gray-500">
            Cargando instrucciones globales...
          </div>
        ) : (
          <>
            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {errorMsg}
              </div>
            )}
            {successMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-center gap-2">
                <i className="bi bi-check-circle-fill"></i>
                <span>{successMsg}</span>
              </div>
            )}

            {/* Reglas base */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-sm font-black text-gray-900 tracking-tight">
                  Reglas base del comportamiento (todas las tiendas)
                </label>
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="text-xs font-bold text-violet-600 hover:text-violet-800 cursor-pointer"
                >
                  Restaurar por defecto
                </button>
              </div>
              <p className="text-xs font-medium text-gray-500 leading-relaxed">
                Define cómo debe comportarse el agente con horarios, ubicaciones, tarifas de envío, pedidos y derivación a humanos.
              </p>
              <textarea
                rows={10}
                value={config.baseRules}
                onChange={(e) => setConfig((prev) => ({ ...prev, baseRules: e.target.value }))}
                maxLength={6000}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 leading-relaxed font-mono"
              />
              <div className="text-right text-[11px] font-medium text-slate-400">
                {config.baseRules.length} / 6000 caracteres
              </div>
            </div>

            {/* Instrucciones adicionales globales */}
            <div className="space-y-1.5">
              <label className="block text-sm font-black text-gray-900 tracking-tight">
                Instrucciones generales adicionales de Fuddi (estilo, tono, vocabulario)
              </label>
              <p className="text-xs font-medium text-gray-500 leading-relaxed">
                Aquí puedes indicar palabras que suelen usar, frases que prefieren evitar, forma de saludar o políticas generales de la plataforma. Cada tienda además puede sumar sus propias instrucciones personalizadas.
              </p>
              <textarea
                rows={6}
                value={config.extraGlobalInstructions}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, extraGlobalInstructions: e.target.value }))
                }
                maxLength={4000}
                placeholder="Ej. Evita sonar robótico o decir 'un asesor revisará tu mensaje'. Di mejor 'ya te confirmo en un momentito'. Usa un español natural de Ecuador y respuestas breves de máximo 3 líneas..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 leading-relaxed"
              />
              <div className="text-right text-[11px] font-medium text-slate-400">
                {config.extraGlobalInstructions.length} / 4000 caracteres
              </div>
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-[11px] font-medium text-gray-500">
                {config.updatedAtMillis
                  ? `Última actualización: ${new Date(config.updatedAtMillis).toLocaleString('es-EC')}`
                  : 'Usando reglas por defecto (sin guardar cambios todavía)'}
              </p>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
              >
                <i className="bi bi-check2-circle"></i>
                <span>{saving ? 'Guardando...' : 'Guardar instrucciones globales'}</span>
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
