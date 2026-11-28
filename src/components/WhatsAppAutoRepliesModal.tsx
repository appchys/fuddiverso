'use client'

import React, { useEffect, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'

export type AutoReplyTriggerMode = 'always' | 'store_open' | 'store_closed' | 'schedule' | 'order_delivered'

export interface WhatsAppAutoReplyRule {
  id: string
  name: string
  message: string
  enabled: boolean
  triggerMode: AutoReplyTriggerMode
  daysOfWeek: number[]
  startTime: string
  endTime: string
  cooldownHours: number
  createdAtMillis?: number
  updatedAtMillis?: number
}

interface WhatsAppAutoRepliesModalProps {
  isOpen: boolean
  businessId?: string
  onClose: () => void
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

const COOLDOWN_OPTIONS = [
  { hours: 0, label: 'Cada mensaje' },
  { hours: 1, label: 'Cada 1 hora' },
  { hours: 6, label: 'Cada 6 horas' },
  { hours: 12, label: 'Cada 12 horas' },
  { hours: 24, label: 'Cada 24 horas' },
  { hours: 168, label: 'Cada 7 días' },
]

const TRIGGER_MODES: Array<{
  value: AutoReplyTriggerMode
  label: string
  desc: string
  icon: string
}> = [
  {
    value: 'always',
    label: 'Siempre',
    desc: 'Responde a cualquier hora (ej. bienvenida)',
    icon: 'bi-chat-heart',
  },
  {
    value: 'store_open',
    label: 'Tienda abierta',
    desc: 'Solo cuando la tienda está abierta',
    icon: 'bi-shop',
  },
  {
    value: 'store_closed',
    label: 'Tienda cerrada',
    desc: 'Solo cuando la tienda está cerrada (ausencia)',
    icon: 'bi-moon-stars',
  },
  {
    value: 'schedule',
    label: 'Horario específico',
    desc: 'Elige días y rango de horas personalizado',
    icon: 'bi-clock-history',
  },
  {
    value: 'order_delivered',
    label: 'Pedido entregado',
    desc: 'Se envía al instante al marcar un pedido como Entregado (con enlace para calificar)',
    icon: 'bi-star-fill',
  },
]

const DEFAULT_DELIVERED_RATING_MESSAGE =
  '¡Gracias por tu pedido, {{cliente}}! 🙌\nEsperamos que lo disfrutes mucho. ¿Nos ayudas calificando tu orden aquí? ⭐\n{{enlace_orden}}'

function formatTriggerSummary(rule: WhatsAppAutoReplyRule): string {
  switch (rule.triggerMode) {
    case 'order_delivered':
      return 'Al marcar pedido como Entregado'
    case 'store_open':
      return 'Cuando la tienda está abierta'
    case 'store_closed':
      return 'Cuando la tienda está cerrada'
    case 'schedule': {
      const days = rule.daysOfWeek || []
      const daysLabel =
        days.length === 7 || days.length === 0
          ? 'Todos los días'
          : DAY_OPTIONS.filter((d) => days.includes(d.value))
              .map((d) => d.label)
              .join(', ')
      return `${daysLabel} · ${rule.startTime || '00:00'} - ${rule.endTime || '23:59'}`
    }
    default:
      return 'Siempre activo'
  }
}

function formatCooldown(hours: number): string {
  if (!hours || hours <= 0) return 'Cada mensaje'
  if (hours === 1) return 'Máx. 1 cada hora'
  if (hours === 168) return 'Máx. 1 cada 7 días'
  return `Máx. 1 cada ${hours}h`
}

export function WhatsAppAutoRepliesModal({
  isOpen,
  businessId,
  onClose,
}: WhatsAppAutoRepliesModalProps) {
  const [rules, setRules] = useState<WhatsAppAutoReplyRule[]>([])
  const [loading, setLoading] = useState(true)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Campos del formulario
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [triggerMode, setTriggerMode] = useState<AutoReplyTriggerMode>('always')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('18:00')
  const [cooldownHours, setCooldownHours] = useState<number>(12)

  useEffect(() => {
    if (!isOpen || !businessId) return
    setLoading(true)
    const q = query(
      collection(db, 'businesses', businessId, 'whatsappAutoReplies'),
      orderBy('createdAtMillis', 'asc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: WhatsAppAutoReplyRule[] = snap.docs.map((d) => {
          const data = d.data() || {}
          return {
            id: d.id,
            name: String(data.name || 'Mensaje automático'),
            message: String(data.message || ''),
            enabled: data.enabled !== false,
            triggerMode: (['always', 'store_open', 'store_closed', 'schedule', 'order_delivered'].includes(data.triggerMode)
              ? data.triggerMode
              : 'always') as AutoReplyTriggerMode,
            daysOfWeek: Array.isArray(data.daysOfWeek) ? data.daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
            startTime: String(data.startTime || '09:00'),
            endTime: String(data.endTime || '18:00'),
            cooldownHours: typeof data.cooldownHours === 'number' ? data.cooldownHours : 12,
            createdAtMillis: Number(data.createdAtMillis || 0),
            updatedAtMillis: Number(data.updatedAtMillis || 0),
          }
        })
        setRules(list)
        setLoading(false)
      },
      () => {
        setLoading(false)
      }
    )
    return () => unsub()
  }, [isOpen, businessId])

  if (!isOpen) return null

  const openCreateForm = () => {
    setEditingRuleId(null)
    setName('')
    setMessage('')
    setEnabled(true)
    setTriggerMode('always')
    setDaysOfWeek([0, 1, 2, 3, 4, 5, 6])
    setStartTime('09:00')
    setEndTime('18:00')
    setCooldownHours(12)
    setErrorMsg(null)
    setIsFormOpen(true)
  }

  const openEditForm = (rule: WhatsAppAutoReplyRule) => {
    setEditingRuleId(rule.id)
    setName(rule.name)
    setMessage(rule.message)
    setEnabled(rule.enabled)
    setTriggerMode(rule.triggerMode)
    setDaysOfWeek(rule.daysOfWeek?.length ? rule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6])
    setStartTime(rule.startTime || '09:00')
    setEndTime(rule.endTime || '18:00')
    setCooldownHours(rule.cooldownHours ?? 12)
    setErrorMsg(null)
    setIsFormOpen(true)
  }

  const toggleDay = (dayVal: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(dayVal)
        ? prev.length > 1
          ? prev.filter((d) => d !== dayVal)
          : prev
        : [...prev, dayVal]
    )
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId) return
    const cleanName = name.trim()
    const cleanMessage = message.trim()
    if (!cleanName) {
      setErrorMsg('Escribe un nombre para identificar este mensaje.')
      return
    }
    if (!cleanMessage) {
      setErrorMsg('Escribe el texto del mensaje automático.')
      return
    }
    setSaving(true)
    setErrorMsg(null)
    try {
      const nowMs = Date.now()
      const payload = {
        name: cleanName,
        message: cleanMessage,
        enabled,
        triggerMode,
        daysOfWeek: triggerMode === 'schedule' ? daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
        startTime: triggerMode === 'schedule' ? startTime : '00:00',
        endTime: triggerMode === 'schedule' ? endTime : '23:59',
        cooldownHours,
        updatedAtMillis: nowMs,
      }
      if (editingRuleId) {
        await updateDoc(doc(db, 'businesses', businessId, 'whatsappAutoReplies', editingRuleId), payload)
      } else {
        await addDoc(collection(db, 'businesses', businessId, 'whatsappAutoReplies'), {
          ...payload,
          createdAtMillis: nowMs,
        })
      }
      setIsFormOpen(false)
      setEditingRuleId(null)
    } catch (err) {
      console.error('Error guardando mensaje automático:', err)
      setErrorMsg('No se pudo guardar el mensaje automático.')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleEnabled = async (rule: WhatsAppAutoReplyRule) => {
    if (!businessId) return
    try {
      await updateDoc(doc(db, 'businesses', businessId, 'whatsappAutoReplies', rule.id), {
        enabled: !rule.enabled,
        updatedAtMillis: Date.now(),
      })
    } catch (err) {
      console.error('Error actualizando estado:', err)
    }
  }

  const handleDelete = async (rule: WhatsAppAutoReplyRule) => {
    if (!businessId) return
    if (!window.confirm(`¿Eliminar el mensaje automático "${rule.name}"?`)) return
    try {
      await deleteDoc(doc(db, 'businesses', businessId, 'whatsappAutoReplies', rule.id))
    } catch (err) {
      console.error('Error eliminando mensaje automático:', err)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/70">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200/70 text-indigo-600 flex items-center justify-center shrink-0">
              <i className="bi bi-robot text-base"></i>
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-gray-900 tracking-tight leading-tight truncate">
                Mensajes automáticos
              </h2>
              <p className="text-[11px] font-medium text-gray-500 leading-relaxed truncate">
                Respuestas por horario o estado de la tienda (WhatsApp)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!isFormOpen && (
              <button
                type="button"
                onClick={openCreateForm}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                <i className="bi bi-plus-lg"></i>
                <span>Nuevo</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 inline-flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Cerrar"
            >
              <i className="bi bi-x-lg text-sm"></i>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {isFormOpen ? (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-600">
                  {editingRuleId ? 'Editar mensaje automático' : 'Crear mensaje automático'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setIsFormOpen(false)
                    setEditingRuleId(null)
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Volver a la lista
                </button>
              </div>

              {errorMsg && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nombre de la regla
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Bienvenida, Fuera de horario, Promo viernes..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Texto del mensaje
                </label>
                <textarea
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Escribe el mensaje que se enviará automáticamente al cliente..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 resize-none"
                />
                {triggerMode === 'order_delivered' && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-slate-500">Insertar:</span>
                    {[
                      { token: '{{cliente}}', label: 'Nombre cliente' },
                      { token: '{{enlace_orden}}', label: 'Enlace para calificar' },
                      { token: '{{tienda}}', label: 'Nombre tienda' },
                    ].map((v) => (
                      <button
                        key={v.token}
                        type="button"
                        onClick={() =>
                          setMessage((prev) =>
                            prev ? `${prev}${prev.endsWith(' ') || prev.endsWith('\n') ? '' : ' '}${v.token}` : v.token
                          )
                        }
                        className="px-2 py-0.5 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-bold transition-colors cursor-pointer"
                      >
                        + {v.label}
                      </button>
                    ))}
                    <p className="w-full text-[11px] text-slate-500 leading-snug">
                      Si no incluyes <code className="font-mono text-slate-700">{'{{enlace_orden}}'}</code>, el enlace para calificar la orden se agregará automáticamente al final.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  ¿Cuándo se envía?
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TRIGGER_MODES.map((opt) => {
                    const active = triggerMode === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setTriggerMode(opt.value)
                          if (opt.value === 'order_delivered') {
                            if (!name.trim()) setName('Calificar pedido entregado')
                            if (!message.trim()) setMessage(DEFAULT_DELIVERED_RATING_MESSAGE)
                          }
                        }}
                        className={`text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                          active
                            ? 'bg-indigo-50 border-indigo-400 ring-1 ring-indigo-400'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <i
                            className={`bi ${opt.icon} text-sm ${
                              active ? 'text-indigo-600' : 'text-slate-500'
                            }`}
                          ></i>
                          <span className="text-xs font-bold text-gray-900">{opt.label}</span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{opt.desc}</p>
                      </button>
                    )
                  })}
                </div>
              </div>

              {triggerMode === 'schedule' && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                      Días activos
                    </label>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {DAY_OPTIONS.map((d) => {
                        const selected = daysOfWeek.includes(d.value)
                        return (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => toggleDay(d.value)}
                            className={`w-8 h-8 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                              selected
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'
                            }`}
                            title={d.label}
                          >
                            {d.short}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Desde (hora Ecuador)
                      </label>
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-gray-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Hasta (hora Ecuador)
                      </label>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-gray-900"
                      />
                    </div>
                  </div>
                </div>
              )}

              {triggerMode !== 'order_delivered' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Frecuencia por cliente (evita repetir el mismo mensaje)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {COOLDOWN_OPTIONS.map((opt) => {
                      const active = cooldownHours === opt.hours
                      return (
                        <button
                          key={opt.hours}
                          type="button"
                          onClick={() => setCooldownHours(opt.hours)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                            active
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="w-4 h-4 rounded accent-indigo-600"
                  />
                  <span className="text-xs font-bold text-slate-700">Activar inmediatamente</span>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsFormOpen(false)
                      setEditingRuleId(null)
                    }}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer"
                  >
                    {saving ? 'Guardando...' : 'Guardar mensaje'}
                  </button>
                </div>
              </div>
            </form>
          ) : loading ? (
            <div className="py-12 text-center text-xs font-medium text-slate-500">
              Cargando mensajes automáticos...
            </div>
          ) : rules.length === 0 ? (
            <div className="py-10 px-4 text-center bg-slate-50/70 rounded-2xl border border-dashed border-slate-200">
              <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-2.5">
                <i className="bi bi-robot text-lg"></i>
              </div>
              <p className="text-sm font-black text-gray-900 tracking-tight">
                Aún no tienes mensajes automáticos
              </p>
              <p className="text-xs font-medium text-gray-500 mt-1 max-w-xs mx-auto leading-relaxed">
                Crea mensajes de bienvenida, ausencia, promociones o avisos según el horario o si tu tienda está abierta o cerrada.
              </p>
              <button
                type="button"
                onClick={openCreateForm}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
              >
                <i className="bi bi-plus-lg"></i>
                <span>Crear primer mensaje</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    rule.enabled
                      ? 'bg-white border-slate-200 shadow-2xs'
                      : 'bg-slate-50/70 border-slate-200/70 opacity-75'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-gray-900 tracking-tight">
                          {rule.name}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            rule.triggerMode === 'order_delivered'
                              ? 'bg-amber-50 text-amber-800 border-amber-300'
                              : rule.triggerMode === 'store_open'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : rule.triggerMode === 'store_closed'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : rule.triggerMode === 'schedule'
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {formatTriggerSummary(rule)}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {rule.triggerMode === 'order_delivered'
                            ? '1 vez por pedido'
                            : formatCooldown(rule.cooldownHours)}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-gray-600 mt-1.5 whitespace-pre-line leading-relaxed line-clamp-3">
                        {rule.message}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleToggleEnabled(rule)}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors cursor-pointer ${
                          rule.enabled
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                        }`}
                        title={rule.enabled ? 'Pausar' : 'Activar'}
                      >
                        {rule.enabled ? 'Activo' : 'Pausado'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditForm(rule)}
                        className="w-7 h-7 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 inline-flex items-center justify-center cursor-pointer"
                        title="Editar"
                      >
                        <i className="bi bi-pencil text-xs"></i>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(rule)}
                        className="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 inline-flex items-center justify-center cursor-pointer"
                        title="Eliminar"
                      >
                        <i className="bi bi-trash text-xs"></i>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
