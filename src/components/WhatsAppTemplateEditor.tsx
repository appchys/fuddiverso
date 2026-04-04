'use client'

import { useEffect, useMemo, useState } from 'react'
import { getWhatsAppTemplates, saveWhatsAppTemplate } from '@/lib/database'
import {
  WHATSAPP_TEMPLATE_DEFINITIONS,
  WHATSAPP_TEMPLATE_VARIABLES,
  getDefaultWhatsAppTemplate,
  renderWhatsAppTemplate
} from '@/lib/whatsappTemplates'

const SAMPLE_VALUES: Record<string, string> = {
  businessName: 'Fuddi Burger',
  businessPhoneLine: '+593987654321',
  customerName: 'Juan Perez',
  customerPhone: '+593991234567',
  deliverySection: '*Detalles de la entrega*\n⚡ Inmediato\nReferencias: Frente al parque\nUbicacion: https://maps.google.com/...',
  pickupLine: '🏪 Retiro en tienda',
  orderType: '⏰ Programado para hoy a las 19:30',
  productsList: '(2) Hamburguesa Doble\n\n(1) Cola 500ml',
  subtotal: '12.50',
  deliveryCostLine: 'Envío: $2.00\n',
  paymentDetailsBlock: '💵 *Cobrar:* $14.50',
  initialMessage: 'Tu pedido está en preparación!',
  deliveryInfo: 'Cdla. Los Olivos, casa esquinera',
  customerTotalBlock: '*Total:* $14.50\n\n',
  paymentMethod: 'Efectivo',
  orderLinkLine: '\nVer tu orden: https://fuddi.com/o/123456',
  references: 'Frente a la farmacia',
  locationLine: 'Ubicacion: https://maps.google.com/...\n\n',
  total: '14.50'
}

export default function WhatsAppTemplateEditor() {
  const [templates, setTemplates] = useState<Record<string, string>>({})
  const [selectedKey, setSelectedKey] = useState<string>(WHATSAPP_TEMPLATE_DEFINITIONS[0]?.key || '')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        setLoading(true)
        const savedTemplates = await getWhatsAppTemplates()
        const mergedTemplates = WHATSAPP_TEMPLATE_DEFINITIONS.reduce<Record<string, string>>((acc, definition) => {
          acc[definition.key] = savedTemplates[definition.key] || definition.defaultTemplate
          return acc
        }, {})

        setTemplates(mergedTemplates)
      } catch (error) {
        console.error('Error loading WhatsApp templates:', error)
        setMessage({ type: 'error', text: 'No se pudieron cargar las plantillas.' })
      } finally {
        setLoading(false)
      }
    }

    loadTemplates()
  }, [])

  useEffect(() => {
    if (!selectedKey) return
    setDraft(templates[selectedKey] || getDefaultWhatsAppTemplate(selectedKey))
  }, [selectedKey, templates])

  const selectedDefinition = useMemo(
    () => WHATSAPP_TEMPLATE_DEFINITIONS.find(item => item.key === selectedKey) || WHATSAPP_TEMPLATE_DEFINITIONS[0],
    [selectedKey]
  )

  const preview = useMemo(() => renderWhatsAppTemplate(draft, SAMPLE_VALUES), [draft])

  const handleSelect = (key: string) => {
    setMessage(null)
    setSelectedKey(key)
    setDraft(templates[key] || getDefaultWhatsAppTemplate(key))
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      setMessage(null)
      await saveWhatsAppTemplate(selectedKey, draft)
      setTemplates(prev => ({ ...prev, [selectedKey]: draft }))
      setMessage({ type: 'success', text: 'Plantilla guardada correctamente.' })
    } catch (error) {
      console.error('Error saving WhatsApp template:', error)
      setMessage({ type: 'error', text: 'No se pudo guardar la plantilla.' })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setDraft(getDefaultWhatsAppTemplate(selectedKey))
    setMessage(null)
  }

  const insertVariable = (variableKey: string) => {
    setDraft(prev => `${prev}{{${variableKey}}}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50">
          <h2 className="text-xl font-bold text-gray-900">Editor de plantillas de WhatsApp</h2>
          <p className="text-sm text-gray-600 mt-1">
            Edita visualmente los textos que usa el sistema al abrir WhatsApp.
          </p>
        </div>

        <div className="p-6 grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)] gap-6">
          <div className="space-y-3">
            {WHATSAPP_TEMPLATE_DEFINITIONS.map((definition) => {
              const active = definition.key === selectedKey
              return (
                <button
                  key={definition.key}
                  type="button"
                  onClick={() => handleSelect(definition.key)}
                  className={`w-full text-left rounded-xl border p-4 transition-all ${
                    active
                      ? 'border-green-300 bg-green-50 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-gray-900">{definition.label}</div>
                      <div className="text-xs text-gray-500 mt-1">{definition.description}</div>
                    </div>
                    <i className={`bi ${active ? 'bi-check-circle-fill text-green-600' : 'bi-chat-left-text text-gray-400'}`}></i>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="space-y-5">
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{selectedDefinition?.label}</h3>
                  <p className="text-sm text-gray-500 mt-1">{selectedDefinition?.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-white transition-colors"
                  >
                    Restaurar base
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
                  >
                    {saving ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>

              {message && (
                <div
                  className={`mt-4 rounded-lg px-4 py-3 text-sm ${
                    message.type === 'success'
                      ? 'bg-green-100 text-green-800 border border-green-200'
                      : 'bg-red-100 text-red-800 border border-red-200'
                  }`}
                >
                  {message.text}
                </div>
              )}

              <div className="mt-5">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Contenido de la plantilla</label>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-full min-h-[320px] rounded-xl border border-gray-300 bg-white p-4 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                />
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-base font-bold text-gray-900">Variables disponibles</h3>
                  <p className="text-sm text-gray-500">Haz clic para insertarlas en la plantilla.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {WHATSAPP_TEMPLATE_VARIABLES.map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    onClick={() => insertVariable(variable.key)}
                    className="px-3 py-2 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold hover:bg-emerald-100 transition-colors"
                    title={variable.example}
                  >
                    {`{{${variable.key}}}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h3 className="text-base font-bold text-gray-900 mb-3">Vista previa</h3>
                <div className="rounded-2xl bg-[#e7ffdb] border border-[#c8f0b0] p-4 shadow-inner">
                  <div className="bg-white rounded-2xl p-4 text-sm text-gray-800 whitespace-pre-wrap leading-6">
                    {preview}
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h3 className="text-base font-bold text-gray-900 mb-3">Guia rapida</h3>
                <div className="space-y-3 text-sm text-gray-600">
                  <p>Las variables se reemplazan al momento de abrir WhatsApp.</p>
                  <p>Si una variable queda vacia, el sistema la deja en blanco sin romper el mensaje.</p>
                  <p>Puedes restaurar el texto base de cada plantilla cuando quieras.</p>
                </div>
                <div className="mt-4 space-y-2 max-h-56 overflow-y-auto pr-1">
                  {WHATSAPP_TEMPLATE_VARIABLES.map((variable) => (
                    <div key={variable.key} className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                      <div className="font-semibold text-gray-800">{`{{${variable.key}}}`}</div>
                      <div className="text-xs text-gray-500 mt-1">{variable.label}</div>
                      <div className="text-xs text-gray-400 mt-1">Ejemplo: {variable.example}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
