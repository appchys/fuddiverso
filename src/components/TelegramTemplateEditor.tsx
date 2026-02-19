'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { saveTelegramTemplate, getTelegramTemplates } from '@/lib/database'

// ─── Types ───────────────────────────────────────────────────
type Recipient = 'store' | 'delivery' | 'customer'

interface TemplateEvent {
    key: string
    label: string
}

interface FieldDef {
    key: string
    label: string
    example: string
}

interface ActionButton {
    text: string
    type: 'url' | 'callback'
    value: string
}

// ─── Config ──────────────────────────────────────────────────
const RECIPIENTS: { key: Recipient; label: string; icon: string }[] = [
    { key: 'store', label: 'Tienda', icon: 'bi-shop' },
    { key: 'delivery', label: 'Delivery', icon: 'bi-scooter' },
    { key: 'customer', label: 'Cliente', icon: 'bi-person' },
]

const EVENTS_BY_RECIPIENT: Record<Recipient, TemplateEvent[]> = {
    store: [
        { key: 'new_order', label: 'Nuevo Pedido' },
        { key: 'confirmed', label: 'Pedido Confirmado' },
        { key: 'delivery_accepted', label: 'Delivery Aceptó' },
    ],
    delivery: [
        { key: 'assigned', label: 'Pedido Asignado' },
        { key: 'accepted', label: 'Pedido Aceptado (Detalles)' },
    ],
    customer: [
        { key: 'confirmed', label: 'Confirmado' },
        { key: 'preparing', label: 'Preparando' },
        { key: 'ready', label: 'Listo' },
        { key: 'on_way', label: 'En Camino' },
        { key: 'delivered', label: 'Entregado' },
        { key: 'cancelled', label: 'Cancelado' },
    ],
}

const AVAILABLE_FIELDS: FieldDef[] = [
    { key: 'businessName', label: 'Nombre Negocio', example: 'La Pizzería' },
    { key: 'customerName', label: 'Nombre Cliente', example: 'Juan Pérez' },
    { key: 'customerPhone', label: 'Teléfono Cliente', example: '0991234567' },
    { key: 'orderId', label: 'ID Orden', example: 'abc123' },
    { key: 'total', label: 'Total', example: '$15.50' },
    { key: 'subtotal', label: 'Subtotal', example: '$12.00' },
    { key: 'deliveryCost', label: 'Costo Envío', example: '$3.50' },
    { key: 'paymentMethod', label: 'Método de Pago', example: '💵 Efectivo' },
    { key: 'deliveryAddress', label: 'Dirección Entrega', example: 'Av. Principal y 2da' },
    { key: 'deliveryType', label: 'Tipo Entrega', example: 'delivery' },
    { key: 'scheduledTime', label: 'Hora Programada', example: 'Hoy a las 3:00 PM' },
    { key: 'items', label: 'Lista de Productos', example: '(2) Pizza Grande\n(1) Coca Cola' },
    { key: 'mapsLink', label: 'Link Google Maps', example: 'https://maps.google.com/...' },
    { key: 'deliveryName', label: 'Nombre Repartidor', example: 'Carlos' },
    { key: 'whatsappLink', label: 'Link WhatsApp', example: 'https://wa.me/593...' },
]

const EMOJI_GROUPS = [
    { label: 'Comida', emojis: ['🍕', '🍔', '🌮', '🍟', '🥗', '🍜', '🍣', '🥤', '☕', '🍩', '🎂', '🍝'] },
    { label: 'Estado', emojis: ['✅', '❌', '⚠️', '⏰', '⚡', '🔔', '📦', '🎉', '🎊', '💯', '🆕', '🔥'] },
    { label: 'Personas', emojis: ['👤', '👨‍🍳', '🛵', '🚴', '🏪', '👋', '🤝', '💪', '🙏', '👍', '📱', '📞'] },
    { label: 'Dinero', emojis: ['💵', '💰', '🏦', '💳', '🧾', '💲', '📊', '📈', '🪙', '💸'] },
    { label: 'Ubicación', emojis: ['📍', '🗺️', '📸', '🏠', '🏁', '🛒', '🚀', '🔗', '📋', '✍️'] },
]

// ─── Default Templates (current hardcoded messages) ──────────
const DEFAULT_TEMPLATES: Record<string, string> = {
    // ── Tienda ──
    store_new_order: `🛵 <b>{{businessName}}!</b>
Hora estimada: {{scheduledTime}}

<b>Datos del cliente</b>
👤 Nombres: {{customerName}}
📱 Whatsapp: <a href="{{whatsappLink}}">{{customerPhone}}</a>

<b>Datos de entrega</b>
🗺️ <a href="{{mapsLink}}">Ver en Google Maps</a>
{{deliveryAddress}}

<b>Detalles del pedido</b>
{{items}}

<b>Detalles del pago</b>
Pedido: {{subtotal}}
Envío: {{deliveryCost}}

{{paymentMethod}}
💰 Valor a cobrar: {{total}}`,

    store_confirmed: `✅ <b>Pedido confirmado</b>

El pedido de <b>{{customerName}}</b> ha sido confirmado exitosamente.
Se está buscando un repartidor.`,

    store_delivery_accepted: `🛵 <b>¡Repartidor asignado!</b>

El repartidor <b>{{deliveryName}}</b> ha aceptado el pedido de <b>{{customerName}}</b>.`,

    // ── Delivery ──
    delivery_assigned: `🛵 <b>[{{businessName}}]</b> tiene un pedido para ti!

<b>Datos de entrega</b>
🗺️ <a href="{{mapsLink}}">Ver en Google Maps</a>
{{deliveryAddress}}

<b>Detalles del pedido</b>
{{items}}

Envío: {{deliveryCost}}

<b>Datos del cliente</b>
👤 {{customerName}}`,

    delivery_accepted: `🛵 <b>{{businessName}}!</b>
Hora estimada: {{scheduledTime}}

<b>Datos del cliente</b>
👤 Nombres: {{customerName}}
📱 Whatsapp: <a href="{{whatsappLink}}">{{customerPhone}}</a>

<b>Datos de entrega</b>
🗺️ <a href="{{mapsLink}}">Ver en Google Maps</a>
{{deliveryAddress}}

<b>Detalles del pedido</b>
{{items}}

<b>Detalles del pago</b>
Pedido: {{subtotal}}
Envío: {{deliveryCost}}

{{paymentMethod}}
💰 Valor a cobrar: {{total}}`,

    // ── Cliente ──
    customer_confirmed: `✅ <b>¡Pedido Confirmado!</b>

El negocio <b>{{businessName}}</b> ha aceptado tu pedido y comenzará a prepararlo pronto.`,

    customer_preparing: `👨‍🍳 <b>¡Manos a la obra!</b>

Están preparando tu pedido en <b>{{businessName}}</b>.`,

    customer_ready: `🎉 <b>¡Tu pedido está listo!</b>

Pronto será entregado o ya puedes pasar a retirarlo.`,

    customer_on_way: `🚴 <b>¡Tu pedido va en camino!</b>

El repartidor ya tiene tu orden y se dirige a tu ubicación.`,

    customer_delivered: `🎊 <b>¡Pedido Entregado!</b>

Gracias por comprar en <b>{{businessName}}</b>. ¡Buen provecho!`,

    customer_cancelled: `❌ <b>Pedido Cancelado</b>

Lo sentimos, tu pedido ha sido cancelado.`,
}

// ─── Component ───────────────────────────────────────────────
export default function TelegramTemplateEditor() {
    const [recipient, setRecipient] = useState<Recipient>('store')
    const [event, setEvent] = useState('new_order')
    const [templateText, setTemplateText] = useState('')
    const [templates, setTemplates] = useState<Record<string, string>>({})
    const [templateButtons, setTemplateButtons] = useState<Record<string, ActionButton[][]>>({})
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [loading, setLoading] = useState(true)
    const [showEmojis, setShowEmojis] = useState(false)
    const [showFields, setShowFields] = useState(false)
    const [showLinkCreator, setShowLinkCreator] = useState(false)
    const [linkUrl, setLinkUrl] = useState('')
    const [linkText, setLinkText] = useState('')
    const [actionButtons, setActionButtons] = useState<ActionButton[][]>([])
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const emojiRef = useRef<HTMLDivElement>(null)
    const fieldsRef = useRef<HTMLDivElement>(null)
    const linkRef = useRef<HTMLDivElement>(null)

    // Current template key
    const templateKey = `${recipient}_${event}`

    // Load templates from Firestore
    useEffect(() => {
        const load = async () => {
            try {
                setLoading(true)
                const { templates: tpl, buttons: btn } = await getTelegramTemplates()
                setTemplates(tpl)
                setTemplateButtons(btn as Record<string, ActionButton[][]>)
            } catch (error) {
                console.error('Error loading templates:', error)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [])

    // Update textarea when switching template
    useEffect(() => {
        setTemplateText(templates[templateKey] || DEFAULT_TEMPLATES[templateKey] || '')
        setActionButtons(templateButtons[templateKey] || [])
        setSaved(false)
    }, [recipient, event, templates, templateButtons, templateKey])

    // When recipient changes, reset event to first available
    useEffect(() => {
        const events = EVENTS_BY_RECIPIENT[recipient]
        if (events.length > 0) {
            setEvent(events[0].key)
        }
    }, [recipient])

    // Close emoji/fields/link dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
                setShowEmojis(false)
            }
            if (fieldsRef.current && !fieldsRef.current.contains(e.target as Node)) {
                setShowFields(false)
            }
            if (linkRef.current && !linkRef.current.contains(e.target as Node)) {
                setShowLinkCreator(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    // ─── Actions ─────────────────────────────────────────────
    const insertAtCursor = useCallback((before: string, after: string = '') => {
        const ta = textareaRef.current
        if (!ta) return
        ta.focus()

        const start = ta.selectionStart
        const end = ta.selectionEnd
        const selected = templateText.substring(start, end)
        const replacement = before + selected + after
        const newText = templateText.substring(0, start) + replacement + templateText.substring(end)

        setTemplateText(newText)
        setSaved(false)

        // Restore cursor position after state update
        requestAnimationFrame(() => {
            ta.focus()
            const newPos = start + before.length + selected.length + after.length
            ta.setSelectionRange(newPos, newPos)
        })
    }, [templateText])

    const wrapSelection = useCallback((tag: string) => {
        const ta = textareaRef.current
        if (!ta) return
        ta.focus()

        const start = ta.selectionStart
        const end = ta.selectionEnd
        const selected = templateText.substring(start, end)

        if (selected) {
            // Wrap selection
            const wrapped = `<${tag}>${selected}</${tag}>`
            const newText = templateText.substring(0, start) + wrapped + templateText.substring(end)
            setTemplateText(newText)
            setSaved(false)

            requestAnimationFrame(() => {
                ta.focus()
                ta.setSelectionRange(start, start + wrapped.length)
            })
        } else {
            // Insert empty tags
            const inserted = `<${tag}></${tag}>`
            const newText = templateText.substring(0, start) + inserted + templateText.substring(end)
            setTemplateText(newText)
            setSaved(false)

            requestAnimationFrame(() => {
                ta.focus()
                const pos = start + tag.length + 2 // position inside tags
                ta.setSelectionRange(pos, pos)
            })
        }
    }, [templateText])

    const insertEmoji = useCallback((emoji: string) => {
        insertAtCursor(emoji)
    }, [insertAtCursor])

    const insertField = useCallback((fieldKey: string) => {
        insertAtCursor(`{{${fieldKey}}}`)
        setShowFields(false)
    }, [insertAtCursor])

    const insertLink = useCallback(() => {
        if (!linkUrl.trim()) return
        const displayText = linkText.trim() || linkUrl.trim()
        insertAtCursor(`<a href="${linkUrl.trim()}">${displayText}</a>`)
        setLinkUrl('')
        setLinkText('')
        setShowLinkCreator(false)
    }, [linkUrl, linkText, insertAtCursor])

    // ─── Action Buttons ──────────────────────────────────────
    const addButtonRow = () => {
        setActionButtons(prev => [...prev, [{ text: '', type: 'url', value: '' }]])
        setSaved(false)
    }

    const addButtonToRow = (rowIndex: number) => {
        setActionButtons(prev => {
            const updated = [...prev]
            updated[rowIndex] = [...updated[rowIndex], { text: '', type: 'url', value: '' }]
            return updated
        })
        setSaved(false)
    }

    const updateButton = (rowIndex: number, btnIndex: number, field: keyof ActionButton, value: string) => {
        setActionButtons(prev => {
            const updated = [...prev]
            updated[rowIndex] = [...updated[rowIndex]]
            updated[rowIndex][btnIndex] = { ...updated[rowIndex][btnIndex], [field]: value }
            return updated
        })
        setSaved(false)
    }

    const removeButton = (rowIndex: number, btnIndex: number) => {
        setActionButtons(prev => {
            const updated = [...prev]
            updated[rowIndex] = updated[rowIndex].filter((_, i) => i !== btnIndex)
            if (updated[rowIndex].length === 0) {
                return updated.filter((_, i) => i !== rowIndex)
            }
            return updated
        })
        setSaved(false)
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            // Clean empty buttons before saving
            const cleanButtons = actionButtons
                .map(row => row.filter(b => b.text.trim()))
                .filter(row => row.length > 0)

            await saveTelegramTemplate(recipient, event, templateText, cleanButtons.length > 0 ? cleanButtons : undefined)
            setTemplates(prev => ({ ...prev, [templateKey]: templateText }))
            setTemplateButtons(prev => ({ ...prev, [templateKey]: cleanButtons }))
            setActionButtons(cleanButtons)
            setSaved(true)
            setTimeout(() => setSaved(false), 3000)
        } catch (error) {
            console.error('Error saving template:', error)
            alert('Error al guardar la plantilla')
        } finally {
            setSaving(false)
        }
    }

    // ─── Preview ─────────────────────────────────────────────
    const renderPreview = () => {
        let preview = templateText

        // Replace field placeholders with example values
        AVAILABLE_FIELDS.forEach(field => {
            const regex = new RegExp(`\\{\\{${field.key}\\}\\}`, 'g')
            preview = preview.replace(regex, `<span style="color:#0ea5e9;font-weight:600;">${field.example}</span>`)
        })

        // Replace any remaining {{...}} with highlighted placeholder
        preview = preview.replace(/\{\{(\w+)\}\}/g, '<span style="color:#f59e0b;font-weight:600;">{{$1}}</span>')

        // Convert newlines to <br>
        preview = preview.replace(/\n/g, '<br/>')

        return preview
    }

    // ─── Render ──────────────────────────────────────────────
    const currentEvents = EVENTS_BY_RECIPIENT[recipient]

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center gap-3 mb-1">
                    <div className="p-2 bg-blue-50 rounded-lg">
                        <i className="bi bi-telegram text-xl text-blue-500"></i>
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-900">Editor de Plantillas de Telegram</h3>
                        <p className="text-sm text-gray-500">Personaliza los mensajes enviados a cada destinatario</p>
                    </div>
                </div>
            </div>

            {/* Selectors */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Recipient Selector */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Destinatario</label>
                        <div className="flex gap-2">
                            {RECIPIENTS.map(r => (
                                <button
                                    key={r.key}
                                    onClick={() => setRecipient(r.key)}
                                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border ${recipient === r.key
                                        ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm'
                                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                                        }`}
                                >
                                    <i className={`bi ${r.icon}`}></i>
                                    {r.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Event Selector */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Evento</label>
                        <select
                            value={event}
                            onChange={e => setEvent(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            {currentEvents.map(ev => (
                                <option key={ev.key} value={ev.key}>{ev.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Template indicator */}
                <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-gray-400 font-mono bg-gray-50 px-2 py-1 rounded">{templateKey}</span>
                    {templates[templateKey] && (
                        <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                            <i className="bi bi-check-circle-fill"></i> Plantilla guardada
                        </span>
                    )}
                    {!templates[templateKey] && DEFAULT_TEMPLATES[templateKey] && (
                        <span className="text-xs text-blue-600 font-medium flex items-center gap-1">
                            <i className="bi bi-file-earmark-text"></i> Borrador por defecto — edita y guarda
                        </span>
                    )}
                    {!templates[templateKey] && !DEFAULT_TEMPLATES[templateKey] && (
                        <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                            <i className="bi bi-exclamation-circle"></i> Sin plantilla
                        </span>
                    )}
                </div>
            </div>

            {/* Editor + Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Editor */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    {/* Toolbar */}
                    <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 bg-gray-50/50 flex-wrap">
                        {/* Format buttons */}
                        <button
                            onClick={() => wrapSelection('b')}
                            className="p-2 rounded-lg hover:bg-gray-200 transition-colors text-gray-700 font-bold text-sm"
                            title="Negrita <b>"
                        >
                            B
                        </button>
                        <button
                            onClick={() => wrapSelection('i')}
                            className="p-2 rounded-lg hover:bg-gray-200 transition-colors text-gray-700 italic text-sm"
                            title="Cursiva <i>"
                        >
                            I
                        </button>
                        <button
                            onClick={() => wrapSelection('u')}
                            className="p-2 rounded-lg hover:bg-gray-200 transition-colors text-gray-700 underline text-sm"
                            title="Subrayado <u>"
                        >
                            U
                        </button>

                        <div className="w-px h-6 bg-gray-200 mx-1"></div>

                        {/* Emoji Picker */}
                        <div className="relative" ref={emojiRef}>
                            <button
                                onClick={() => { setShowEmojis(!showEmojis); setShowFields(false) }}
                                className={`p-2 rounded-lg transition-colors text-sm ${showEmojis ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200 text-gray-700'}`}
                                title="Insertar Emoji"
                            >
                                😀
                            </button>
                            {showEmojis && (
                                <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-200 p-3 z-50 w-72">
                                    {EMOJI_GROUPS.map(group => (
                                        <div key={group.label} className="mb-2">
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{group.label}</p>
                                            <div className="flex flex-wrap gap-0.5">
                                                {group.emojis.map(emoji => (
                                                    <button
                                                        key={emoji}
                                                        onClick={() => insertEmoji(emoji)}
                                                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-lg"
                                                    >
                                                        {emoji}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="w-px h-6 bg-gray-200 mx-1"></div>

                        {/* Fields Dropdown */}
                        <div className="relative" ref={fieldsRef}>
                            <button
                                onClick={() => { setShowFields(!showFields); setShowEmojis(false) }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${showFields ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200 text-gray-700'}`}
                                title="Insertar Campo Dinámico"
                            >
                                <i className="bi bi-braces"></i>
                                Campos
                                <i className={`bi bi-chevron-${showFields ? 'up' : 'down'} text-[10px]`}></i>
                            </button>
                            {showFields && (
                                <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-200 p-2 z-50 w-72 max-h-80 overflow-y-auto">
                                    {AVAILABLE_FIELDS.map(field => (
                                        <button
                                            key={field.key}
                                            onClick={() => insertField(field.key)}
                                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors text-left group"
                                        >
                                            <div>
                                                <span className="text-sm font-medium text-gray-900 group-hover:text-blue-700">{field.label}</span>
                                                <span className="block text-[10px] text-gray-400 font-mono">{`{{${field.key}}}`}</span>
                                            </div>
                                            <span className="text-xs text-gray-400 group-hover:text-blue-500">{field.example}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="w-px h-6 bg-gray-200 mx-1"></div>

                        {/* Link Creator */}
                        <div className="relative" ref={linkRef}>
                            <button
                                onClick={() => {
                                    setShowLinkCreator(!showLinkCreator)
                                    setShowEmojis(false)
                                    setShowFields(false)
                                    // Pre-fill with selected text
                                    if (!showLinkCreator && textareaRef.current) {
                                        const ta = textareaRef.current
                                        const sel = templateText.substring(ta.selectionStart, ta.selectionEnd)
                                        if (sel) setLinkText(sel)
                                    }
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${showLinkCreator ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200 text-gray-700'}`}
                                title="Insertar Enlace"
                            >
                                <i className="bi bi-link-45deg"></i>
                                Enlace
                            </button>
                            {showLinkCreator && (
                                <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-200 p-4 z-50 w-80">
                                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Crear Enlace</p>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 mb-1">Texto a mostrar</label>
                                            <input
                                                type="text"
                                                value={linkText}
                                                onChange={e => setLinkText(e.target.value)}
                                                placeholder="Ej: Ver en Google Maps"
                                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                autoFocus
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 mb-1">URL</label>
                                            <input
                                                type="text"
                                                value={linkUrl}
                                                onChange={e => setLinkUrl(e.target.value)}
                                                placeholder="https://... o {{mapsLink}}"
                                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                                                onKeyDown={e => { if (e.key === 'Enter') insertLink() }}
                                            />
                                            <p className="text-[10px] text-gray-400 mt-1">Puedes usar campos como <code className="bg-gray-100 px-1 rounded">{'{{mapsLink}}'}</code> o <code className="bg-gray-100 px-1 rounded">{'{{whatsappLink}}'}</code></p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={insertLink}
                                                disabled={!linkUrl.trim()}
                                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-40"
                                            >
                                                <i className="bi bi-link-45deg"></i>
                                                Insertar Enlace
                                            </button>
                                            <button
                                                onClick={() => { setShowLinkCreator(false); setLinkUrl(''); setLinkText('') }}
                                                className="px-3 py-2 text-gray-500 hover:text-gray-700 text-xs font-medium"
                                            >
                                                Cancelar
                                            </button>
                                        </div>
                                    </div>
                                    {/* Preview */}
                                    {linkUrl.trim() && (
                                        <div className="mt-3 pt-3 border-t border-gray-100">
                                            <p className="text-[10px] text-gray-400 mb-1">Vista previa del código:</p>
                                            <code className="block text-[11px] bg-gray-50 px-2 py-1.5 rounded-lg text-gray-600 break-all">
                                                {`<a href="${linkUrl.trim()}">${linkText.trim() || linkUrl.trim()}</a>`}
                                            </code>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Textarea */}
                    <div className="p-4">
                        <textarea
                            ref={textareaRef}
                            value={templateText}
                            onChange={e => { setTemplateText(e.target.value); setSaved(false) }}
                            placeholder={`Escribe la plantilla para ${RECIPIENTS.find(r => r.key === recipient)?.label} — ${currentEvents.find(e => e.key === event)?.label}...\n\nEjemplo:\n✅ <b>¡Pedido Confirmado!</b>\n\nEl negocio <b>{{businessName}}</b> ha aceptado tu pedido.\n👤 Cliente: {{customerName}}\n💰 Total: {{total}}`}
                            className="w-full h-72 resize-none text-sm font-mono text-gray-800 leading-relaxed focus:outline-none placeholder:text-gray-300"
                            spellCheck={false}
                        />
                    </div>

                    {/* Save Button */}
                    <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {saved && (
                                <span className="text-xs text-green-600 font-medium flex items-center gap-1 animate-fade-in">
                                    <i className="bi bi-check-circle-fill"></i> Guardado
                                </span>
                            )}
                        </div>
                        <button
                            onClick={handleSave}
                            disabled={saving || !templateText.trim()}
                            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                        >
                            {saving ? (
                                <>
                                    <i className="bi bi-arrow-clockwise animate-spin"></i>
                                    Guardando...
                                </>
                            ) : (
                                <>
                                    <i className="bi bi-save"></i>
                                    Guardar Plantilla
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Preview Panel */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
                        <i className="bi bi-eye text-gray-400"></i>
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Vista Previa</span>
                        <span className="text-[10px] text-gray-400 ml-auto">Datos de ejemplo</span>
                    </div>

                    <div className="p-4">
                        {templateText.trim() ? (
                            <div className="bg-[#1a2332] rounded-xl p-4 min-h-[280px]">
                                {/* Simulated Telegram message bubble */}
                                <div className="bg-[#2b5278] rounded-xl rounded-tl-sm p-3 max-w-full">
                                    <div
                                        className="text-sm text-gray-100 leading-relaxed whitespace-pre-wrap break-words [&_b]:font-bold [&_i]:italic [&_u]:underline [&_a]:text-blue-300 [&_a]:underline [&_span]:inline"
                                        dangerouslySetInnerHTML={{ __html: renderPreview() }}
                                    />
                                    <div className="text-right mt-1">
                                        <span className="text-[10px] text-gray-400">
                                            {new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </div>

                                {/* Action Buttons Preview */}
                                {actionButtons.length > 0 && actionButtons.some(row => row.some(b => b.text.trim())) && (
                                    <div className="mt-2 space-y-1">
                                        {actionButtons.map((row, ri) => (
                                            <div key={ri} className="flex gap-1">
                                                {row.filter(b => b.text.trim()).map((btn, bi) => (
                                                    <div
                                                        key={bi}
                                                        className="flex-1 text-center py-2 px-3 bg-[#2b5278] rounded-lg text-[13px] font-medium text-blue-300 hover:bg-[#345e8a] transition-colors cursor-pointer"
                                                    >
                                                        {btn.type === 'url' && <i className="bi bi-box-arrow-up-right text-[10px] mr-1"></i>}
                                                        {btn.text || 'Botón'}
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64 text-gray-300">
                                <i className="bi bi-chat-left-text text-4xl mb-3"></i>
                                <p className="text-sm font-medium">Escribe una plantilla para ver la vista previa</p>
                            </div>
                        )}
                    </div>

                    {/* Legend */}
                    <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                        <p className="text-[10px] text-gray-400 font-medium">
                            <span className="inline-block w-2 h-2 rounded-full bg-sky-400 mr-1"></span>
                            Campos dinámicos se resaltan en azul.
                            Telegram soporta: <code className="bg-gray-100 px-1 rounded">&lt;b&gt;</code> <code className="bg-gray-100 px-1 rounded">&lt;i&gt;</code> <code className="bg-gray-100 px-1 rounded">&lt;u&gt;</code> <code className="bg-gray-100 px-1 rounded">&lt;a href=&quot;...&quot;&gt;</code>
                        </p>
                    </div>
                </div>
            </div>

            {/* Action Buttons Builder */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 rounded-lg">
                            <i className="bi bi-grid-3x2-gap text-indigo-600"></i>
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-gray-900">Botones de Acción</h4>
                            <p className="text-[10px] text-gray-400">Botones interactivos debajo del mensaje</p>
                        </div>
                    </div>
                    <button
                        onClick={addButtonRow}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors border border-indigo-200"
                    >
                        <i className="bi bi-plus-lg"></i>
                        Agregar Fila
                    </button>
                </div>

                {actionButtons.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                        <i className="bi bi-grid-3x2-gap text-3xl text-gray-300 mb-2"></i>
                        <p className="text-sm text-gray-400 font-medium">Sin botones de acción</p>
                        <p className="text-[10px] text-gray-300 mt-1">Agrega filas de botones que aparecerán debajo del mensaje</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {actionButtons.map((row, rowIndex) => (
                            <div key={rowIndex} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Fila {rowIndex + 1}</span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => addButtonToRow(rowIndex)}
                                            className="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-0.5 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                                            title="Agregar botón a esta fila"
                                        >
                                            <i className="bi bi-plus text-xs"></i> Botón
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {row.map((btn, btnIndex) => (
                                        <div key={btnIndex} className="flex items-start gap-2 bg-white rounded-lg p-2.5 border border-gray-100">
                                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                                                <input
                                                    type="text"
                                                    value={btn.text}
                                                    onChange={e => updateButton(rowIndex, btnIndex, 'text', e.target.value)}
                                                    placeholder="Texto del botón"
                                                    className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                                <select
                                                    value={btn.type}
                                                    onChange={e => updateButton(rowIndex, btnIndex, 'type', e.target.value)}
                                                    className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white appearance-none"
                                                >
                                                    <option value="url">🔗 URL</option>
                                                    <option value="callback">⚡ Callback</option>
                                                </select>
                                                <input
                                                    type="text"
                                                    value={btn.value}
                                                    onChange={e => updateButton(rowIndex, btnIndex, 'value', e.target.value)}
                                                    placeholder={btn.type === 'url' ? 'https://...' : 'callback_data'}
                                                    className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                                                />
                                            </div>
                                            <button
                                                onClick={() => removeButton(rowIndex, btnIndex)}
                                                className="p-1.5 text-gray-300 hover:text-red-500 transition-colors shrink-0"
                                                title="Eliminar botón"
                                            >
                                                <i className="bi bi-trash3 text-xs"></i>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Quick Reference */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-4">
                    <i className="bi bi-lightbulb text-amber-500"></i>
                    <h4 className="text-sm font-bold text-gray-900">Referencia Rápida</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Formato</p>
                        <div className="space-y-1.5 text-xs text-gray-600">
                            <p><code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px]">&lt;b&gt;texto&lt;/b&gt;</code> → <b>texto</b></p>
                            <p><code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px]">&lt;i&gt;texto&lt;/i&gt;</code> → <i>texto</i></p>
                            <p><code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px]">&lt;u&gt;texto&lt;/u&gt;</code> → <u>texto</u></p>
                        </div>
                    </div>
                    <div>
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Campos</p>
                        <div className="space-y-1.5 text-xs text-gray-600">
                            <p><code className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono text-[11px]">{'{{customerName}}'}</code> → Nombre del cliente</p>
                            <p><code className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono text-[11px]">{'{{total}}'}</code> → Total de la orden</p>
                            <p><code className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono text-[11px]">{'{{items}}'}</code> → Lista de productos</p>
                        </div>
                    </div>
                    <div>
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Enlaces</p>
                        <div className="space-y-1.5 text-xs text-gray-600">
                            <p><code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px]">&lt;a href=&quot;URL&quot;&gt;texto&lt;/a&gt;</code></p>
                            <p className="text-gray-400">Los links son clickeables en Telegram</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
