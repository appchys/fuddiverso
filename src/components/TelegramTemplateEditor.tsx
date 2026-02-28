'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { saveTelegramTemplate, getTelegramTemplates } from '@/lib/database'

// ─── Types ───────────────────────────────────────────────────
type Recipient = 'store' | 'delivery' | 'customer'
type TemplateType = 'entry' | 'update'

interface TemplateEvent {
    key: string
    label: string
}

interface FieldDef {
    key: string
    label: string
    example: string
    options?: Array<{ value: string; label: string }>
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

const TEMPLATE_TYPES: { key: TemplateType; label: string; icon: string; desc: string }[] = [
    { key: 'entry', label: 'Entrada', icon: 'bi-envelope-plus', desc: 'Mensaje nuevo inicial' },
    { key: 'update', label: 'Actualización', icon: 'bi-pencil-square', desc: 'Edición de mensaje existente' },
]

// ─── NUEVO: Estructura centrada en eventos ──────────────────
interface EventDefinition {
    key: string
    label: string
}

interface EventWithRecipients extends EventDefinition {
    recipients: Array<{ recipient: Recipient; label: string }>
}

// Eventos de entrada
const ENTRY_EVENTS: EventWithRecipients[] = [
    {
        key: 'new_order',
        label: 'Nuevo Pedido',
        recipients: [
            { recipient: 'store', label: 'Tienda' },
        ],
    },
    {
        key: 'assigned',
        label: 'Pedido Asignado',
        recipients: [
            { recipient: 'delivery', label: 'Delivery' },
        ],
    },
    {
        key: 'confirmed',
        label: 'Confirmado',
        recipients: [
            { recipient: 'customer', label: 'Cliente' },
        ],
    },
]

// Eventos de actualización
const UPDATE_EVENTS: EventWithRecipients[] = [
    {
        key: 'confirmed',
        label: 'Pedido Confirmado',
        recipients: [
            { recipient: 'store', label: 'Tienda' },
        ],
    },
    {
        key: 'delivery_accepted',
        label: 'Delivery Aceptó',
        recipients: [
            { recipient: 'store', label: 'Tienda' },
        ],
    },
    {
        key: 'accepted',
        label: 'Pedido Aceptado',
        recipients: [
            { recipient: 'delivery', label: 'Delivery' },
        ],
    },
    {
        key: 'on_way',
        label: 'En Camino',
        recipients: [
            { recipient: 'delivery', label: 'Delivery' },
            { recipient: 'customer', label: 'Cliente' },
        ],
    },
    {
        key: 'delivered',
        label: 'Entregado',
        recipients: [
            { recipient: 'delivery', label: 'Delivery' },
            { recipient: 'customer', label: 'Cliente' },
        ],
    },
    {
        key: 'discarded',
        label: 'Descartado',
        recipients: [
            { recipient: 'delivery', label: 'Delivery' },
        ],
    },
    {
        key: 'preparing',
        label: 'Preparando',
        recipients: [
            { recipient: 'customer', label: 'Cliente' },
        ],
    },
    {
        key: 'ready',
        label: 'Listo',
        recipients: [
            { recipient: 'customer', label: 'Cliente' },
        ],
    },
    {
        key: 'cancelled',
        label: 'Cancelado',
        recipients: [
            { recipient: 'customer', label: 'Cliente' },
        ],
    },
]

// Helpers para buscar eventos
const getEventsByType = (type: TemplateType): EventWithRecipients[] => {
    return type === 'entry' ? ENTRY_EVENTS : UPDATE_EVENTS
}

const getEventLabel = (eventKey: string, type: TemplateType): string => {
    const events = getEventsByType(type)
    return events.find(e => e.key === eventKey)?.label || eventKey
}

// ─── Mantener compatibilidad con estructura antigua ────────
const EVENTS_BY_RECIPIENT: Record<Recipient, Record<TemplateType, TemplateEvent[]>> = {
    store: {
        entry: [
            { key: 'new_order', label: 'Nuevo Pedido' },
        ],
        update: [
            { key: 'confirmed', label: 'Pedido Confirmado' },
            { key: 'delivery_accepted', label: 'Delivery Aceptó' },
        ],
    },
    delivery: {
        entry: [
            { key: 'assigned', label: 'Pedido Asignado' },
        ],
        update: [
            { key: 'accepted', label: 'Pedido Aceptado (Detalles)' },
            { key: 'on_way', label: 'En Camino' },
            { key: 'delivered', label: 'Entregado' },
            { key: 'discarded', label: 'Descartado' },
        ],
    },
    customer: {
        entry: [
            { key: 'confirmed', label: 'Confirmado' },
        ],
        update: [
            { key: 'preparing', label: 'Preparando' },
            { key: 'ready', label: 'Listo' },
            { key: 'on_way', label: 'En Camino' },
            { key: 'delivered', label: 'Entregado' },
            { key: 'cancelled', label: 'Cancelado' },
        ],
    },
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
    {
        key: 'deliveryType',
        label: 'Tipo Entrega',
        example: 'A Domicilio'
    },
    {
        key: 'deliveryTypeRaw',
        label: 'Tipo Entrega (Raw)',
        example: 'delivery',
        options: [
            { value: 'delivery', label: 'A Domicilio' },
            { value: 'pickup', label: 'Retiro en Tienda' },
        ]
    },
    { key: 'scheduledTime', label: 'Hora Programada (Solo Hora)', example: '3:00 PM' },
    { key: 'scheduledDateTime', label: 'Hora Programada (con día)', example: 'Hoy a las 3:00 PM' },
    { key: 'items', label: 'Lista de Productos', example: '(2) Pizza Grande\n(1) Coca Cola' },
    { key: 'mapsLink', label: 'Link Google Maps', example: 'https://maps.google.com/...' },
    { key: 'deliveryName', label: 'Nombre Repartidor', example: 'Carlos' },
    { key: 'whatsappLink', label: 'Link WhatsApp', example: 'https://wa.me/593...' },
    { key: 'confirmedBy', label: 'Confirmado por', example: 'María' },
    { key: 'locationPhoto', label: 'Foto de la ubicación', example: 'https://firebasestorage.googleapis.com/v0/b/fuddiverso.appspot.com/o/locations%2Fexample.jpg?alt=media' },
    {
        key: 'orderStatus',
        label: 'Estado de la Orden',
        example: '⏳ Pendiente',
        options: [
            { value: 'pending', label: '⏳ Pendiente' },
            { value: 'confirmed', label: '✅ Confirmado' },
            { value: 'preparing', label: '👨‍🍳 En preparación' },
            { value: 'ready', label: '🎉 Listo' },
            { value: 'on_way', label: '🛵 En camino' },
            { value: 'delivered', label: '🏁 Entregado' },
            { value: 'cancelled', label: '❌ Cancelado' },
            { value: 'borrador', label: '📝 Borrador' }
        ]
    },
    {
        key: 'paymentMethodRaw',
        label: 'Método Pago (Raw)',
        example: 'cash',
        options: [
            { value: 'cash', label: 'Efectivo' },
            { value: 'transfer', label: 'Transferencia' },
            { value: 'mixed', label: 'Mixto' },
        ]
    },
    {
        key: 'orderTimingType',
        label: 'Tipo Tiempo (Inmediato/Programado)',
        example: '⚡ Inmediato',
        options: [
            { value: 'immediate', label: '⚡ Inmediato' },
            { value: 'scheduled', label: '⏰ Programado' },
        ]
    },
    {
        key: 'deliveryAcceptanceStatus',
        label: 'Estado Aceptación Delivery',
        example: '✅ Confirmado',
        options: [
            { value: 'accepted', label: '✅ Confirmado' },
            { value: 'pending', label: '⏳ Esperando confirmación' },
        ]
    },
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
Hora estimada: {{scheduledDateTime}}

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
Hora estimada: {{scheduledDateTime}}

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

    // ── Delivery Updates ──
    delivery_on_way: `🛵 <b>En camino</b>

El repartidor se dirige a entregar el pedido de <b>{{customerName}}</b>.`,

    delivery_delivered: `<b>{{businessName}}</b> · {{customerName}}
{{deliveryAddress}}

Pedido: {{subtotal}}
Envío: {{deliveryCost}}

{{paymentMethod}}

🎉 <b>Entregado</b>`,

    delivery_discarded: `<b>{{businessName}}</b> · {{customerName}}

❌ Descartado`,
}

// ─── Default Buttons (current hardcoded inline_keyboard) ─────
const DEFAULT_BUTTONS: Record<string, ActionButton[][]> = {
    store_new_order: [
        [
            { text: '✅ Aceptar Pedido', type: 'callback', value: 'biz_confirm|{token}' },
            { text: '❌ Descartar', type: 'callback', value: 'biz_discard|{token}' },
        ],
    ],
    delivery_assigned: [
        [
            { text: '✅ Aceptar', type: 'callback', value: 'order_confirm|{token}' },
            { text: '❌ Descartar', type: 'callback', value: 'order_discard|{token}' },
        ],
    ],
    delivery_accepted: [
        [
            { text: '🛵 En camino', type: 'callback', value: 'order_on_way|{token}' },
            { text: '✅ Entregada', type: 'callback', value: 'order_delivered|{token}' },
        ],
    ],
}

// ─── Callback → Template Navigation Map ──────────────────────
interface CallbackMapping {
    recipient: Recipient
    event: string
    templateType: TemplateType
    dbIcon: string
    dbActions: string[]
}

const CALLBACK_TO_TEMPLATE: Record<string, CallbackMapping> = {
    'biz_confirm': {
        recipient: 'store', event: 'confirmed', templateType: 'update',
        dbIcon: '✅',
        dbActions: [
            'status → "confirmed"',
            'autoAssignDelivery() → delivery.assignedDelivery',
            'delivery.assignedAt → timestamp',
            'confirmedBy → nombre del operador',
        ],
    },
    'biz_discard': {
        recipient: 'store', event: 'confirmed', templateType: 'update',
        dbIcon: '❌',
        dbActions: [
            'status → "cancelled"',
            'statusHistory.cancelledAt → timestamp',
        ],
    },
    'order_confirm': {
        recipient: 'delivery', event: 'accepted', templateType: 'update',
        dbIcon: '✅',
        dbActions: [
            'delivery.acceptanceStatus → "accepted"',
        ],
    },
    'order_discard': {
        recipient: 'delivery', event: 'discarded', templateType: 'update',
        dbIcon: '❌',
        dbActions: [
            'delivery.assignedDelivery → null',
            'delivery.rejectedBy ← arrayUnion(deliveryId)',
        ],
    },
    'order_on_way': {
        recipient: 'delivery', event: 'on_way', templateType: 'update',
        dbIcon: '🛵',
        dbActions: [
            'status → "on_way"',
            'statusHistory.on_wayAt → timestamp',
        ],
    },
    'order_delivered': {
        recipient: 'delivery', event: 'delivered', templateType: 'update',
        dbIcon: '🏁',
        dbActions: [
            'status → "delivered"',
            'deliveredAt → timestamp',
            'statusHistory.deliveredAt → timestamp',
        ],
    },
}

// ─── Component ───────────────────────────────────────────────
export default function TelegramTemplateEditor() {
    // ─── Vista y navegación ──────────────────────────────────
    const [viewMode, setViewMode] = useState<'form' | 'table'>('form')
    const [templateType, setTemplateType] = useState<TemplateType>('entry')
    const [selectedEvent, setSelectedEvent] = useState('new_order')
    const [selectedRecipient, setSelectedRecipient] = useState<Recipient>('store')

    // ─── Estado de edición ───────────────────────────────────
    const [templateText, setTemplateText] = useState('')
    const [templates, setTemplates] = useState<Record<string, string>>({})
    const [templateButtons, setTemplateButtons] = useState<Record<string, ActionButton[][]>>({})
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [loading, setLoading] = useState(true)

    // ─── UI State ────────────────────────────────────────────
    const [showEmojis, setShowEmojis] = useState(false)
    const [showFields, setShowFields] = useState(false)
    const [showLinkCreator, setShowLinkCreator] = useState(false)
    const [showCondBuilder, setShowCondBuilder] = useState(false)
    const [linkUrl, setLinkUrl] = useState('')
    const [linkText, setLinkText] = useState('')
    const [waMessage, setWaMessage] = useState('')

    // Conditional Builder State
    const [condField, setCondField] = useState('paymentMethodRaw')
    const [condOperator, setCondOperator] = useState('==')
    const [condValue, setCondValue] = useState('')
    const [condTrueText, setCondTrueText] = useState('')
    const [condFalseText, setCondFalseText] = useState('')

    const [actionButtons, setActionButtons] = useState<ActionButton[][]>([])
    const [copied, setCopied] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const emojiRef = useRef<HTMLDivElement>(null)
    const fieldsRef = useRef<HTMLDivElement>(null)
    const linkRef = useRef<HTMLDivElement>(null)
    const condRef = useRef<HTMLDivElement>(null)

    // Context-aware input tracking
    const [lastFocusedInput, setLastFocusedInput] = useState<'main' | 'condTrue' | 'condFalse' | null>('main')
    const condTrueRef = useRef<HTMLTextAreaElement>(null)
    const condFalseRef = useRef<HTMLTextAreaElement>(null)

    // Current template key
    const templateKey = `${selectedRecipient}_${selectedEvent}`

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
        setActionButtons(templateButtons[templateKey] || DEFAULT_BUTTONS[templateKey] || [])
        setSaved(false)
    }, [selectedRecipient, selectedEvent, templates, templateButtons, templateKey])

    // When templateType changes, actualizar el evento seleccionado
    useEffect(() => {
        const events = getEventsByType(templateType)
        if (events.length > 0) {
            setSelectedEvent(events[0].key)
            // Y actualizar el recipient al primero disponible del nuevo evento
            if (events[0].recipients.length > 0) {
                setSelectedRecipient(events[0].recipients[0].recipient)
            }
        }
    }, [templateType])

    // Cuando cambia el evento, validar que el recipient sea válido
    useEffect(() => {
        const events = getEventsByType(templateType)
        const eventDef = events.find(e => e.key === selectedEvent)

        if (eventDef && eventDef.recipients.length > 0) {
            // Si el recipient actual no está en la lista, seleccionar el primero
            if (!eventDef.recipients.find(r => r.recipient === selectedRecipient)) {
                setSelectedRecipient(eventDef.recipients[0].recipient)
            }
        }
    }, [selectedEvent, templateType, selectedRecipient])

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
            if (condRef.current && !condRef.current.contains(e.target as Node)) {
                setShowCondBuilder(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    // ─── Actions ─────────────────────────────────────────────
    const getActiveInputRef = useCallback(() => {
        if (lastFocusedInput === 'condTrue') return condTrueRef.current
        if (lastFocusedInput === 'condFalse') return condFalseRef.current
        return textareaRef.current
    }, [lastFocusedInput])

    const insertAtCursor = useCallback((before: string, after: string = '') => {
        const ta = getActiveInputRef()
        if (!ta) return
        ta.focus()

        const start = ta.selectionStart
        const end = ta.selectionEnd
        const currentVal = ta.value
        const replacement = before + currentVal.substring(start, end) + after
        const newVal = currentVal.substring(0, start) + replacement + currentVal.substring(end)

        if (lastFocusedInput === 'condTrue') setCondTrueText(newVal)
        else if (lastFocusedInput === 'condFalse') setCondFalseText(newVal)
        else {
            setTemplateText(newVal)
            setSaved(false)
        }

        requestAnimationFrame(() => {
            ta.focus()
            const newPos = start + before.length + (currentVal.substring(start, end).length) + after.length
            ta.setSelectionRange(newPos, newPos)
        })
    }, [lastFocusedInput, getActiveInputRef])

    const wrapSelection = useCallback((tag: string) => {
        const ta = getActiveInputRef()
        if (!ta) return
        ta.focus()

        const start = ta.selectionStart
        const end = ta.selectionEnd
        const currentVal = ta.value
        const selected = currentVal.substring(start, end)

        let wrapped = ''
        let newPosStart = start
        let newPosEnd = start

        if (selected) {
            wrapped = `<${tag}>${selected}</${tag}>`
            newPosEnd = start + wrapped.length
        } else {
            wrapped = `<${tag}></${tag}>`
            newPosStart = start + tag.length + 2
            newPosEnd = newPosStart
        }

        const newVal = currentVal.substring(0, start) + wrapped + currentVal.substring(end)

        if (lastFocusedInput === 'condTrue') setCondTrueText(newVal)
        else if (lastFocusedInput === 'condFalse') setCondFalseText(newVal)
        else {
            setTemplateText(newVal)
            setSaved(false)
        }

        requestAnimationFrame(() => {
            ta.focus()
            ta.setSelectionRange(newPosStart, newPosEnd)
        })
    }, [lastFocusedInput, getActiveInputRef])

    const insertEmoji = useCallback((emoji: string) => {
        insertAtCursor(emoji)
    }, [insertAtCursor])

    const insertField = useCallback((fieldKey: string) => {
        insertAtCursor(`{{${fieldKey}}}`)
        setShowFields(false)
    }, [insertAtCursor])

    const insertLink = useCallback(() => {
        if (!linkUrl.trim()) return
        let finalUrl = linkUrl.trim()

        if (finalUrl === '{{whatsappLink}}' && waMessage.trim()) {
            const encoded = encodeURIComponent(waMessage.trim()).replace(/%7B/g, '{').replace(/%7D/g, '}')
            finalUrl = `${finalUrl}?text=${encoded}`
        }

        const displayText = linkText.trim() || linkUrl.trim()
        insertAtCursor(`<a href="${finalUrl}">${displayText}</a>`)
        setLinkUrl('')
        setLinkText('')
        setWaMessage('')
        setShowLinkCreator(false)
    }, [linkUrl, linkText, waMessage, insertAtCursor])

    const insertCondition = useCallback(() => {
        if (!condField) return

        let condition = `{{#if ${condField}`
        if (condOperator !== 'exists') {
            condition += ` ${condOperator} '${condValue}'`
        }
        condition += `}}${condTrueText}`
        if (condFalseText) {
            condition += `{{else}}${condFalseText}`
        }
        condition += `{{/if}}`

        // Siempre insertar en el editor principal
        const ta = textareaRef.current
        if (ta) {
            ta.focus()
            const start = ta.selectionStart
            const end = ta.selectionEnd
            const currentVal = templateText
            const newVal = currentVal.substring(0, start) + condition + currentVal.substring(end)

            setTemplateText(newVal)
            setSaved(false)
            setLastFocusedInput('main')

            // Usar requestAnimationFrame para asegurar que el DOM se actualice antes de mover el cursor
            requestAnimationFrame(() => {
                ta.focus()
                const newPos = start + condition.length
                ta.setSelectionRange(newPos, newPos)
            })
        }

        setCondTrueText('')
        setCondFalseText('')
        setCondValue('')
        setShowCondBuilder(false)
    }, [condField, condOperator, condValue, condTrueText, condFalseText, templateText])

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

    // --- Validación de HTML ---
    let templateError: string | null = null;
    if (templateText) {
        const cleanedText = templateText.replace(/\{\{[\s\S]*?\}\}/g, '');
        const tags = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre'];
        for (const tag of tags) {
            const openMatches = cleanedText.match(new RegExp(`<${tag}(?: [^>]*)?>`, 'gi')) || [];
            const closeMatches = cleanedText.match(new RegExp(`</${tag}>`, 'gi')) || [];
            if (openMatches.length !== closeMatches.length) {
                templateError = `Etiqueta HTML <${tag}> desbalanceada (Abiertas: ${openMatches.length}, Cerradas: ${closeMatches.length})`;
                break;
            }
        }
        if (!templateError && /<a\s+href=(["'])\s*\1\s*>/i.test(cleanedText)) {
            templateError = "Un enlace <a> no tiene destino (href vacío)";
        }
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            // Clean empty buttons before saving
            const cleanButtons = actionButtons
                .map(row => row.filter(b => b.text.trim()))
                .filter(row => row.length > 0)

            await saveTelegramTemplate(selectedRecipient, selectedEvent, templateText, cleanButtons.length > 0 ? cleanButtons : undefined)
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

    const handleCopy = async () => {
        if (!templateText) return
        try {
            await navigator.clipboard.writeText(templateText)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy text: ', err)
        }
    }

    // ─── Preview ─────────────────────────────────────────────
    const renderPreview = () => {
        let preview = templateText

        // Build a variables map from example data
        const exampleVars: Record<string, string> = {}
        AVAILABLE_FIELDS.forEach(f => {
            exampleVars[f.key] = f.example
        })

        // 1. Process conditional blocks: {{#if condition}} content [{{else}} alternative] {{/if}}
        const ifRegex = /\{\{#if\s+([\w.]+)(?:\s*(==|!=|contains)\s*(?:'([^']*)'|"([^"]*)"))?\s*\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
        preview = preview.replace(ifRegex, (match, variable, operator, val1, val2, content, alternative) => {
            const varValue = exampleVars[variable];
            const compareValue = val1 || val2;
            let html = '';

            // Render True block
            if (content && content.trim()) {
                let badgeTrue = `<span style="font-size: 10px; font-weight: bold; background: #22c55e; color: white; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-bottom: 4px;">SI CUMPLE: ${variable} ${operator ? operator : ''} ${compareValue ? compareValue : ''}</span><br/>`;
                html += `<div style="border-left: 3px solid #22c55e; padding-left: 8px; display: block; margin: 6px 0; background: rgba(34, 197, 94, 0.05); padding-top: 6px; padding-bottom: 6px;">${badgeTrue}${content}</div>`;
            }

            // Render False block
            if (alternative && alternative.trim()) {
                let badgeFalse = `<span style="font-size: 10px; font-weight: bold; background: #ef4444; color: white; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-bottom: 4px;">SINO</span><br/>`;
                html += `<div style="border-left: 3px solid #ef4444; padding-left: 8px; display: block; margin: 6px 0; background: rgba(239, 68, 68, 0.05); padding-top: 6px; padding-bottom: 6px;">${badgeFalse}${alternative}</div>`;
            }

            return html;
        });

        // 2. Replace field placeholders with example values
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
    const currentEventsList = getEventsByType(templateType)
    const currentEventDef = currentEventsList.find(e => e.key === selectedEvent)

    // Compare with current saved/default data
    const originalText = templates[templateKey] !== undefined ? templates[templateKey] : (DEFAULT_TEMPLATES[templateKey] || '');
    const originalButtons = templateButtons[templateKey] !== undefined ? templateButtons[templateKey] : (DEFAULT_BUTTONS[templateKey] || []);
    const cleanCurrentButtons = actionButtons
        .map(row => row.filter(b => b.text.trim()))
        .filter(row => row.length > 0);
    const hasTextChanges = templateText !== originalText;
    const hasButtonChanges = JSON.stringify(cleanCurrentButtons) !== JSON.stringify(originalButtons);
    const hasChanges = hasTextChanges || hasButtonChanges;

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
                        <p className="text-sm text-gray-500">Personaliza los mensajes por evento y destinatario</p>
                    </div>
                </div>
            </div>

            {/* Event Selection - TOP LEVEL */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
                {/* Template Type */}
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Tipo de Evento</label>
                    <div className="flex gap-2">
                        {TEMPLATE_TYPES.map(t => (
                            <button
                                key={t.key}
                                onClick={() => setTemplateType(t.key)}
                                className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all border ${templateType === t.key
                                    ? t.key === 'entry'
                                        ? 'bg-green-50 text-green-700 border-green-200 shadow-sm'
                                        : 'bg-amber-50 text-amber-700 border-amber-200 shadow-sm'
                                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                                    }`}
                                title={t.desc}
                            >
                                <i className={`bi ${t.icon}`}></i>
                                {t.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Event */}
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Selecciona un Evento</label>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {currentEventsList.map(evt => (
                            <button
                                key={evt.key}
                                onClick={() => setSelectedEvent(evt.key)}
                                className={`px-4 py-3 rounded-xl text-sm font-medium transition-all border text-left ${selectedEvent === evt.key
                                    ? 'bg-blue-50 text-blue-700 border-blue-300 shadow-sm ring-2 ring-blue-200'
                                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                                    }`}
                            >
                                <div className="font-bold">{evt.label}</div>
                                <div className="text-[10px] text-gray-500 mt-1">
                                    {evt.recipients.length > 0 && (
                                        <>Se envía a: {evt.recipients.map(r => r.label).join(', ')}</>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* VIEW MODE TABS */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-2 inline-flex gap-2">
                <button
                    onClick={() => setViewMode('form')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all ${viewMode === 'form'
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-50'
                        }`}
                >
                    <i className="bi bi-pencil-square"></i>
                    Formulario
                </button>
                <button
                    onClick={() => setViewMode('table')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all ${viewMode === 'table'
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-50'
                        }`}
                >
                    <i className="bi bi-table"></i>
                    Vista Tabla
                </button>
            </div>

            {/* FORM VIEW */}
            {viewMode === 'form' && (
                <div className="space-y-6">
                    {/* Recipient Selection */}
                    {currentEventDef && currentEventDef.recipients.length > 0 && (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">¿A quién enviarle?</label>
                            <div className="flex gap-3 flex-wrap">
                                {currentEventDef.recipients.map(rec => (
                                    <button
                                        key={rec.recipient}
                                        onClick={() => setSelectedRecipient(rec.recipient)}
                                        className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all border ${selectedRecipient === rec.recipient
                                            ? 'bg-blue-50 text-blue-700 border-blue-300 shadow-sm'
                                            : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                                            }`}
                                    >
                                        <i className={`bi ${RECIPIENTS.find(r => r.key === rec.recipient)?.icon}`}></i>
                                        {rec.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Template Info */}
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">Plantilla Actual</p>
                                <p className="text-sm text-blue-600 font-mono mt-1">{templateKey}</p>
                            </div>
                            {templates[templateKey] ? (
                                <div className="text-right">
                                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold">
                                        <i className="bi bi-check-circle-fill"></i> Guardada
                                    </span>
                                </div>
                            ) : DEFAULT_TEMPLATES[templateKey] ? (
                                <div className="text-right">
                                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">
                                        <i className="bi bi-file-earmark-text"></i> Borrador
                                    </span>
                                </div>
                            ) : (
                                <div className="text-right">
                                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">
                                        <i className="bi bi-exclamation-circle"></i> Vacía
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Editor + Preview */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-280px)] min-h-[600px] mb-6">
                        {/* Editor */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-full relative z-10">
                            {/* Toolbar */}
                            <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 bg-gray-50/50 flex-wrap rounded-t-xl">
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
                                        <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 p-3 z-[100] w-72">
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
                                        <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 p-2 z-[100] w-72 max-h-80 overflow-y-auto">
                                            {AVAILABLE_FIELDS.map(field => (
                                                <button
                                                    key={field.key}
                                                    onClick={() => insertField(field.key)}
                                                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors text-xs text-gray-700 hover:text-blue-700 font-medium border-0 focus:outline-none"
                                                >
                                                    <span className="font-mono text-blue-600">{'{{' + field.key + '}}'}</span> — {field.label}
                                                    <div className="text-[10px] text-gray-400 mt-0.5">Ej: <em>{field.example}</em></div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="w-px h-6 bg-gray-200 mx-1"></div>

                                {/* Link Creator */}
                                <div className="relative" ref={linkRef}>
                                    <button
                                        onClick={() => { setShowLinkCreator(!showLinkCreator); setShowEmojis(false); setShowFields(false) }}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${showLinkCreator ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200 text-gray-700'}`}
                                        title="Insertar Link"
                                    >
                                        <i className="bi bi-link-45deg"></i>
                                        Link
                                    </button>
                                    {showLinkCreator && (
                                        <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 p-3 z-[100] w-80">
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Sugerencias de URL:</label>
                                                    <div className="flex flex-wrap gap-1 mb-2">
                                                        {[
                                                            { key: 'mapsLink', label: 'Maps', icon: '📍' },
                                                            { key: 'whatsappLink', label: 'WA', icon: '📱' },
                                                            { key: 'locationPhoto', label: '📸 Foto', text: '🖼 Foto adjunta' }
                                                        ].map(sug => (
                                                            <button
                                                                key={sug.key}
                                                                onClick={() => {
                                                                    setLinkUrl(`{{${sug.key}}}`)
                                                                    if (sug.text) setLinkText(sug.text)
                                                                }}
                                                                className="px-2 py-1 bg-gray-50 border border-gray-100 rounded-lg text-[10px] font-medium text-gray-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-all"
                                                            >
                                                                {sug.icon} {sug.key === 'locationPhoto' ? 'Foto ubicación' : sug.key}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                <input
                                                    type="text"
                                                    value={linkUrl}
                                                    onChange={e => setLinkUrl(e.target.value)}
                                                    placeholder="URL o {{campo}}..."
                                                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                                />
                                                {linkUrl === '{{whatsappLink}}' && (
                                                    <input
                                                        type="text"
                                                        value={waMessage}
                                                        onChange={e => setWaMessage(e.target.value)}
                                                        placeholder="Mensaje WA (ej: Hola {{businessName}})"
                                                        className="w-full px-3 py-2 text-xs border border-green-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-green-50"
                                                    />
                                                )}
                                                <input
                                                    type="text"
                                                    value={linkText}
                                                    onChange={e => setLinkText(e.target.value)}
                                                    placeholder="Texto visible (opcional)"
                                                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                                <button
                                                    onClick={insertLink}
                                                    className="w-full px-3 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors"
                                                >
                                                    Insertar Link
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="w-px h-6 bg-gray-200 mx-1"></div>

                                {/* Conditional Builder */}
                                <div className="relative" ref={condRef}>
                                    <button
                                        onClick={() => { setShowCondBuilder(!showCondBuilder); setShowEmojis(false); setShowFields(false); setShowLinkCreator(false) }}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${showCondBuilder ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200 text-gray-700'}`}
                                        title="Constructor de Condicionales"
                                    >
                                        <i className="bi bi-question-diamond"></i>
                                        Condición
                                    </button>
                                    {showCondBuilder && (
                                        <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 z-[100] w-96">
                                            <div className="space-y-4">
                                                <div className="flex items-center gap-2">
                                                    <i className="bi bi-magic text-blue-500"></i>
                                                    <span className="text-xs font-bold text-gray-700 uppercase tracking-tight">Constructor de Lógica</span>
                                                </div>

                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Si este campo...</label>
                                                        <select
                                                            value={condField}
                                                            onChange={e => setCondField(e.target.value)}
                                                            className="w-full px-2 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                                        >
                                                            {AVAILABLE_FIELDS.map(f => (
                                                                <option key={f.key} value={f.key}>{f.label}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Es...</label>
                                                        <select
                                                            value={condOperator}
                                                            onChange={e => setCondOperator(e.target.value)}
                                                            className="w-full px-2 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                                        >
                                                            <option value="==">Igual a</option>
                                                            <option value="!=">Diferente de</option>
                                                            <option value="contains">Contiene</option>
                                                            <option value="exists">Existe / No vacío</option>
                                                        </select>
                                                    </div>
                                                </div>

                                                {condOperator !== 'exists' && (
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">A este valor:</label>
                                                        {AVAILABLE_FIELDS.find(f => f.key === condField)?.options ? (
                                                            <select
                                                                value={condValue}
                                                                onChange={e => setCondValue(e.target.value)}
                                                                className="w-full px-2 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                                            >
                                                                <option value="">Selecciona una opción...</option>
                                                                {AVAILABLE_FIELDS.find(f => f.key === condField)?.options?.map(opt => (
                                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                                ))}
                                                            </select>
                                                        ) : (
                                                            <input
                                                                type="text"
                                                                value={condValue}
                                                                onChange={e => setCondValue(e.target.value)}
                                                                placeholder="valor..."
                                                                className="w-full px-3 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                                            />
                                                        )}
                                                    </div>
                                                )}

                                                <div className="space-y-3 pt-2">
                                                    <div className="p-3 bg-green-50 rounded-xl border border-green-100">
                                                        <label className="block text-[10px] font-bold text-green-600 uppercase mb-1">Entonces mostrar:</label>
                                                        <textarea
                                                            ref={condTrueRef}
                                                            value={condTrueText}
                                                            onFocus={() => setLastFocusedInput('condTrue')}
                                                            onChange={e => setCondTrueText(e.target.value)}
                                                            placeholder="Texto si es verdadero..."
                                                            className="w-full h-16 p-2 text-[11px] border border-green-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 resize-none bg-white"
                                                        />
                                                    </div>

                                                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                                                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Sino mostrar (opcional):</label>
                                                        <textarea
                                                            ref={condFalseRef}
                                                            value={condFalseText}
                                                            onFocus={() => setLastFocusedInput('condFalse')}
                                                            onChange={e => setCondFalseText(e.target.value)}
                                                            placeholder="Texto si es falso..."
                                                            className="w-full h-16 p-2 text-[11px] border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none bg-white"
                                                        />
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={insertCondition}
                                                    disabled={!condField}
                                                    className="w-full px-3 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition-all shadow-sm shadow-blue-200 active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                                                >
                                                    <i className="bi bi-plus-circle"></i>
                                                    Insertar Condición
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="w-px h-6 bg-gray-200 mx-1"></div>

                                {/* Save */}
                                {hasChanges && (
                                    <button
                                        onClick={handleSave}
                                        disabled={saving || !!templateError}
                                        className={`ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold transition-all border ${saving
                                            ? 'bg-gray-100 text-gray-400 border-gray-200'
                                            : templateError
                                                ? 'bg-red-50 text-red-500 border-red-200 opacity-60 cursor-not-allowed'
                                                : saved
                                                    ? 'bg-green-100 text-green-700 border-green-200'
                                                    : 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200'
                                            }`}
                                    >
                                        {saving && <span className="animate-spin">⚙️</span>}
                                        {saving ? 'Guardando...' : saved ? '✓ Guardada' : 'Guardar'}
                                    </button>
                                )}
                            </div>

                            {/* Mensaje de Error (Validación HTML) */}
                            {templateError && (
                                <div className="bg-red-50 text-red-600 px-4 py-2 text-xs font-bold border-b border-red-200 flex items-center gap-2">
                                    <i className="bi bi-exclamation-triangle-fill text-red-500"></i>
                                    {templateError} - Corrige esto antes de guardar para evitar errores en Telegram.
                                </div>
                            )}

                            {/* Textarea */}
                            <div className="relative flex-1 rounded-b-xl overflow-hidden">
                                <textarea
                                    ref={textareaRef}
                                    value={templateText}
                                    onFocus={() => setLastFocusedInput('main')}
                                    onChange={e => { setTemplateText(e.target.value); setSaved(false) }}
                                    placeholder="Escribe tu plantilla aquí..."
                                    className="w-full h-full px-4 py-3 text-sm text-gray-700 border-none focus:outline-none resize-none font-mono"
                                />

                                {/* Copy Button */}
                                <button
                                    onClick={handleCopy}
                                    className={`absolute bottom-4 right-4 p-2.5 rounded-xl shadow-lg border transition-all flex items-center gap-2 group ${copied
                                        ? 'bg-green-500 text-white border-green-600 scale-105'
                                        : 'bg-white text-gray-400 border-gray-100 hover:text-blue-600 hover:border-blue-100 hover:bg-blue-50'
                                        }`}
                                    title="Copiar contenido"
                                >
                                    {copied ? (
                                        <>
                                            <i className="bi bi-check-lg text-lg"></i>
                                            <span className="text-[10px] font-bold uppercase tracking-wider">¡Copiado!</span>
                                        </>
                                    ) : (
                                        <>
                                            <i className="bi bi-copy text-lg"></i>
                                            <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 text-[10px] font-bold uppercase tracking-wider">Copiar</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Preview */}
                        <div className="bg-gray-900 rounded-xl shadow-sm border border-gray-700 overflow-hidden flex flex-col h-full">
                            <div className="px-4 py-3 border-b border-gray-700 bg-gray-800 flex items-center gap-2">
                                <i className="bi bi-eye text-blue-400"></i>
                                <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Vista Previa</span>
                            </div>
                            <div className="p-4 flex-1 overflow-y-auto text-white text-sm leading-relaxed">
                                {templateText ? (
                                    <div className="space-y-4">
                                        <div
                                            className="bg-gray-800 rounded-lg p-3 border border-gray-600"
                                            dangerouslySetInnerHTML={{ __html: renderPreview() }}
                                        />
                                        {/* Callback buttons info */}
                                        {Object.entries(CALLBACK_TO_TEMPLATE).map(([callbackKey, navTarget]) => {
                                            const isRelevant = navTarget.event === selectedEvent && navTarget.recipient === selectedRecipient && navTarget.templateType === templateType
                                            if (!isRelevant) return null
                                            return (
                                                <div key={callbackKey} className="relative">
                                                    <div className="bg-gray-800 border border-gray-600 rounded-lg p-3">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{navTarget.dbIcon} Callback</span>
                                                            <code className="text-[10px] text-amber-300 font-mono">{callbackKey}</code>
                                                        </div>
                                                        {/* DB Actions */}
                                                        <div className="border-t border-gray-700 pt-2">
                                                            <div className="flex items-center gap-1 mb-1.5">
                                                                <i className="bi bi-database text-amber-400 text-[10px]"></i>
                                                                <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">Acciones en DB</span>
                                                            </div>
                                                            <div className="space-y-0.5">
                                                                {navTarget.dbActions.map((action, ai) => (
                                                                    <div key={ai} className="flex items-start gap-1.5">
                                                                        <span className="text-gray-500 text-[9px] mt-0.5 shrink-0">•</span>
                                                                        <code className="text-[10px] text-gray-300 font-mono leading-tight">{action}</code>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        {/* Arrow indicator */}
                                                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 border-r border-b border-gray-700 rotate-45"></div>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                                        <i className="bi bi-chat-left-text text-4xl mb-3"></i>
                                        <p className="text-sm font-medium">Escribe una plantilla para ver la vista previa</p>
                                    </div>
                                )}
                            </div>

                            {/* Legend */}
                            <div className="px-4 py-3 border-t border-gray-700 bg-gray-800">
                                <p className="text-[10px] text-gray-400 font-medium">
                                    <span className="inline-block w-2 h-2 rounded-full bg-sky-400 mr-1"></span>
                                    Campos dinámicos se resaltan en azul.
                                    Telegram soporta: <code className="bg-gray-700 px-1 rounded">&lt;b&gt;</code> <code className="bg-gray-700 px-1 rounded">&lt;i&gt;</code> <code className="bg-gray-700 px-1 rounded">&lt;u&gt;</code> <code className="bg-gray-700 px-1 rounded">&lt;a&gt;</code>
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
                </div>
            )}

            {/* TABLE VIEW */}
            {viewMode === 'table' && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Destinatario</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Estado</th>
                                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {currentEventDef ? (
                                    currentEventDef.recipients.length > 0 ? (
                                        currentEventDef.recipients.map(rec => {
                                            const recKey = `${rec.recipient}_${selectedEvent}`
                                            const hasTemplate = templates[recKey]
                                            const hasDefault = DEFAULT_TEMPLATES[recKey]
                                            return (
                                                <tr key={rec.recipient} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <div className="p-1.5 bg-blue-50 rounded-lg w-8 h-8 flex items-center justify-center">
                                                                <i className={`bi ${RECIPIENTS.find(r => r.key === rec.recipient)?.icon} text-blue-600 text-sm`}></i>
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-bold text-gray-900">{rec.label}</p>
                                                                <p className="text-[10px] text-gray-500 font-mono">{recKey}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {hasTemplate ? (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold">
                                                                <i className="bi bi-check-circle-fill"></i> Guardada
                                                            </span>
                                                        ) : hasDefault ? (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">
                                                                <i className="bi bi-file-earmark-text"></i> Borrador
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">
                                                                <i className="bi bi-exclamation-circle"></i> Vacía
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <button
                                                            onClick={() => {
                                                                setViewMode('form')
                                                                setSelectedRecipient(rec.recipient)
                                                            }}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors border border-blue-200"
                                                        >
                                                            <i className="bi bi-pencil-square"></i>
                                                            Editar
                                                        </button>
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    ) : (
                                        <tr>
                                            <td colSpan={3} className="px-4 py-8 text-center">
                                                <p className="text-gray-400 text-sm">Este evento no tiene destinatarios</p>
                                            </td>
                                        </tr>
                                    )
                                ) : (
                                    <tr>
                                        <td colSpan={3} className="px-4 py-8 text-center">
                                            <p className="text-gray-400 text-sm">Selecciona un evento primero</p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Reference Section */}
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
