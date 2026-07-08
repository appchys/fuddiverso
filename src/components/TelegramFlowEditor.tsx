'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { saveTelegramTemplate } from '@/lib/database'

// ─── CONSTANTS & TYPES ───────────────────────────────────────
type Recipient = 'store' | 'delivery' | 'customer' | 'admin'
type TemplateType = 'entry' | 'update'

interface ActionButton {
    text: string
    type: 'url' | 'callback'
    value: string
}

interface FlowNode {
    id: string
    type: 'trigger' | 'action'
    key: string // event key for triggers (e.g., new_order) or recipient key for actions (e.g., store)
    label: string
    x: number
    y: number
    icon: string
    category?: TemplateType // trigger category
    boundEventKey?: string // for action nodes, once connected to a trigger
}

interface Connection {
    id: string
    fromId: string
    toId: string
}

// Event trigger details
const EVENT_INFOS: Record<string, { label: string; desc: string; category: TemplateType; icon: string; validRecipients: Recipient[] }> = {
    new_order: { label: 'Nuevo Pedido', desc: 'Mensaje nuevo al recibir una orden', category: 'entry', icon: 'bi-envelope-plus', validRecipients: ['store', 'admin'] },
    reminder: { label: 'Recordatorio (Programado)', desc: 'Aviso programado antes de la entrega', category: 'entry', icon: 'bi-alarm', validRecipients: ['store'] },
    assigned: { label: 'Pedido Asignado', desc: 'Asignación de orden a un repartidor', category: 'entry', icon: 'bi-scooter', validRecipients: ['delivery'] },
    confirmed_entry: { label: 'Confirmado (Cliente)', desc: 'Mensaje inicial de pedido confirmado', category: 'entry', icon: 'bi-person-check', validRecipients: ['customer'] },
    
    confirmed: { label: 'Pedido Confirmado', desc: 'Actualización tras confirmar orden', category: 'update', icon: 'bi-check-circle', validRecipients: ['store', 'admin'] },
    delivery_accepted: { label: 'Delivery Aceptó', desc: 'Actualización cuando el repartidor acepta', category: 'update', icon: 'bi-person-check-fill', validRecipients: ['store', 'admin'] },
    accepted: { label: 'Pedido Aceptado', desc: 'Repartidor aceptó y ve los detalles', category: 'update', icon: 'bi-hand-thumbs-up', validRecipients: ['delivery', 'admin'] },
    on_way: { label: 'En Camino', desc: 'Orden en ruta de entrega', category: 'update', icon: 'bi-cursor-fill', validRecipients: ['delivery', 'customer', 'admin'] },
    delivered: { label: 'Entregado', desc: 'Orden entregada exitosamente', category: 'update', icon: 'bi-flag-fill', validRecipients: ['delivery', 'customer', 'admin'] },
    discarded: { label: 'Descartado', desc: 'Orden descartada por tienda o delivery', category: 'update', icon: 'bi-x-circle', validRecipients: ['delivery', 'admin'] },
    preparing: { label: 'Preparando', desc: 'Orden en preparación en cocina', category: 'update', icon: 'bi-egg-fried', validRecipients: ['customer', 'admin'] },
    ready: { label: 'Listo', desc: 'Orden lista para retirar o enviar', category: 'update', icon: 'bi-bag-check', validRecipients: ['customer', 'admin'] },
    cancelled: { label: 'Cancelado', desc: 'Orden cancelada', category: 'update', icon: 'bi-slash-circle', validRecipients: ['customer', 'admin'] },
}

const RECIPIENT_INFOS: Record<Recipient, { label: string; icon: string; color: string; bg: string; border: string }> = {
    store: { label: 'Tienda', icon: 'bi-shop', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
    delivery: { label: 'Repartidor', icon: 'bi-scooter', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
    customer: { label: 'Cliente', icon: 'bi-person', color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
    admin: { label: 'Administrador', icon: 'bi-shield-lock', color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' },
}

// ─── VISUAL EDITOR UTILS ─────────────────────────────────────
type VisualToken =
    | { type: 'text'; raw: string }
    | { type: 'field'; raw: string; key: string }
    | { type: 'conditional'; raw: string; field: string; operator?: string; value?: string; contentTrue: string; contentFalse: string }

function visualTokenize(template: string): VisualToken[] {
    const tokens: VisualToken[] = []
    let lastIndex = 0
    const regex = /\{\{#if\s+([\w.]+)(?:\s*(==|!=|contains)\s*['"]([^'"]*?)['"])?\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}|\{\{([\w.]+)\}\}/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(template)) !== null) {
        if (m.index > lastIndex) tokens.push({ type: 'text', raw: template.substring(lastIndex, m.index) })
        if (m[1]) {
            tokens.push({
                type: 'conditional', raw: m[0],
                field: m[1], operator: m[2] || undefined, value: m[3] || undefined,
                contentTrue: m[4] || '', contentFalse: m[5] || '',
            })
        } else if (m[6]) {
            tokens.push({ type: 'field', raw: m[0], key: m[6] })
        }
        lastIndex = m.index + m[0].length
    }
    if (lastIndex < template.length) tokens.push({ type: 'text', raw: template.substring(lastIndex) })
    return tokens
}

function buildVisualFragment(
    tokens: VisualToken[],
    onCondClick: (tok: Extract<VisualToken, { type: 'conditional' }>) => void
): DocumentFragment {
    const frag = document.createDocumentFragment()
    for (const tok of tokens) {
        if (tok.type === 'text') {
            tok.raw.split('\n').forEach((line, i) => {
                if (i > 0) frag.appendChild(document.createElement('br'))
                if (line) frag.appendChild(document.createTextNode(line))
            })
        } else if (tok.type === 'field') {
            const el = document.createElement('span')
            el.setAttribute('contenteditable', 'false')
            el.setAttribute('data-raw', tok.raw)
            el.className = 'inline-block align-baseline mx-0.5 px-1.5 rounded text-[11px] font-semibold bg-sky-950 border border-sky-700 text-sky-300 select-none cursor-default leading-5'
            el.textContent = `{${tok.key}}`
            frag.appendChild(el)
        } else if (tok.type === 'conditional') {
            const b = tok
            const label = b.contentTrue.trim().substring(0, 20) || b.field
            const el = document.createElement('button')
            el.setAttribute('contenteditable', 'false')
            el.setAttribute('data-raw', tok.raw)
            el.type = 'button'
            el.className = 'inline-block align-baseline mx-0.5 px-1.5 rounded text-[11px] font-semibold bg-amber-950 border border-amber-700 text-amber-300 hover:bg-amber-900 select-none cursor-pointer leading-5 transition-colors'
            el.title = `Condición: ${b.field} ${b.operator ?? ''} ${b.value ? `'${b.value}'` : ''}\nClick para editar`
            el.innerHTML = `<i class="bi bi-question-diamond text-[9px] mr-0.5"></i>${label}${b.contentFalse ? ' <i class="bi bi-arrow-left-right text-[9px]"></i>' : ''}`
            el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onCondClick(b) })
            frag.appendChild(el)
        }
    }
    return frag
}

function extractVisualTemplate(container: HTMLElement): string {
    let out = ''
    let isFirst = true
    function walk(node: Node) {
        if (node.nodeType === Node.TEXT_NODE) { out += node.textContent ?? ''; return }
        if (node.nodeType !== Node.ELEMENT_NODE) return
        const el = node as HTMLElement
        const raw = el.getAttribute('data-raw')
        if (raw !== null) { out += raw; return }
        if (el.tagName === 'BR') { out += '\n'; return }
        if (el.tagName === 'DIV' || el.tagName === 'P') {
            if (!isFirst) out += '\n'
            isFirst = false
            Array.from(el.childNodes).forEach(walk)
            return
        }
        Array.from(el.childNodes).forEach(walk)
    }
    Array.from(container.childNodes).forEach(walk)
    return out
}

function ceInsertTextAt(text: string, range: Range): Range {
    range.deleteContents()
    const tn = document.createTextNode(text)
    range.insertNode(tn)
    const newRange = range.cloneRange()
    newRange.setStartAfter(tn)
    newRange.setEndAfter(tn)
    return newRange
}

function ceWrapSelectionAt(tag: string, range: Range): Range {
    const selectedText = range.toString()
    const wrapped = selectedText ? `<${tag}>${selectedText}</${tag}>` : `<${tag}></${tag}>`
    return ceInsertTextAt(wrapped, range)
}

const AVAILABLE_FIELDS = [
    { key: 'businessName', label: 'Nombre Negocio', example: 'La Pizzería' },
    { key: 'customerName', label: 'Nombre Cliente', example: 'Juan Pérez' },
    { key: 'customerPhone', label: 'Teléfono Cliente', example: '0991234567' },
    { key: 'orderId', label: 'ID Orden', example: 'abc123' },
    { key: 'total', label: 'Total', example: '$15.50' },
    { key: 'subtotal', label: 'Subtotal', example: '$12.00' },
    { key: 'deliveryCost', label: 'Costo Envío', example: '$3.50' },
    { key: 'paymentMethod', label: 'Método de Pago', example: '💵 Efectivo' },
    { key: 'deliveryAddress', label: 'Dirección Entrega', example: 'Av. Principal y 2da' },
    { key: 'items', label: 'Lista de Productos', example: '(2) Pizza Grande\n(1) Coca Cola' },
    { key: 'mapsLink', label: 'Link Google Maps', example: 'https://maps.google.com/...' },
    { key: 'deliveryName', label: 'Nombre Repartidor', example: 'Carlos' },
    { key: 'whatsappLink', label: 'Link WhatsApp', example: 'https://wa.me/593...' },
]

const EMOJI_GROUPS = [
    { label: 'Comida', emojis: ['🍕', '🍔', '🌮', '🍟', '🥤', '☕', '🍩'] },
    { label: 'Estado', emojis: ['✅', '❌', '⚠️', '⏰', '⚡', '🎉', '🔔'] },
    { label: 'Gente', emojis: ['👤', '👨‍🍳', '🛵', '👋', '🤝', '👍', '📞'] },
    { label: 'Dinero', emojis: ['💵', '💰', '💳', '🧾'] },
    { label: 'Mapa', emojis: ['📍', '🗺️', '🏠', '🏁', '🚀', '📋'] },
]

// Default template texts (matching existing fallbacks)
const DEFAULT_TEMPLATES: Record<string, string> = {
    store_new_order: `🛵 <b>{{businessName}}!</b>\nHora estimada: {{scheduledDateTime}}\n\n<b>Datos del cliente</b>\n👤 Nombres: {{customerName}}\n📱 Whatsapp: <a href="{{whatsappLink}}">{{customerPhone}}</a>\n\n<b>Datos de entrega</b>\n🗺️ <a href="{{mapsLink}}">Ver en Google Maps</a>\n{{deliveryAddress}}\n\n<b>Detalles del pedido</b>\n{{items}}\n\n<b>Detalles del pago</b>\nPedido: {{subtotal}}\nEnvío: {{deliveryCost}}\n\n{{paymentMethod}}\n💰 Valor a cobrar: {{total}}`,
    store_reminder: `⏰ <b>¡Recordatorio de Pedido!</b>\nEl pedido de <b>{{customerName}}</b> está programado para dentro de 30 minutos.\n\n<b>Hora:</b> {{scheduledDateTime}}\n<b>Productos:</b>\n{{items}}\n\n<b>Entrega:</b> {{deliveryAddress}}`,
    delivery_assigned: `🛵 <b>[{{businessName}}]</b> tiene un pedido para ti!\n\n<b>Datos de entrega</b>\n🗺️ <a href="{{mapsLink}}">Ver en Google Maps</a>\n{{deliveryAddress}}\n\n<b>Detalles del pedido</b>\n{{items}}\n\nEnvío: {{deliveryCost}}\n\n<b>Datos del cliente</b>\n👤 {{customerName}}`,
    customer_confirmed: `✅ <b>¡Pedido Confirmado!</b>\n\nEl negocio <b>{{businessName}}</b> ha aceptado tu pedido y comenzará a prepararlo pronto.`
}

const DEFAULT_BUTTONS: Record<string, ActionButton[][]> = {
    store_new_order: [[{ text: '✅ Aceptar Pedido', type: 'callback', value: 'biz_confirm|{token}' }, { text: '❌ Descartar', type: 'callback', value: 'biz_discard|{token}' }]],
    delivery_assigned: [[{ text: '✅ Aceptar', type: 'callback', value: 'order_confirm|{token}' }, { text: '❌ Descartar', type: 'callback', value: 'order_discard|{token}' }]],
}

// Props
interface TelegramFlowEditorProps {
    templates: Record<string, string>
    templateButtons: Record<string, ActionButton[][]>
    onSave: (recipient: string, event: string, text: string, buttons?: ActionButton[][]) => Promise<void>
    onDelete: (recipient: string, event: string) => Promise<void>
}

export default function TelegramFlowEditor({ templates, templateButtons, onSave, onDelete }: TelegramFlowEditorProps) {
    const canvasRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<SVGSVGElement>(null)

    // Canvas panning/zooming states
    const [pan, setPan] = useState({ x: 50, y: 50 })
    const [zoom, setZoom] = useState(0.95)
    const [isPanning, setIsPanning] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)

    // Escape key listener to exit fullscreen mode
    useEffect(() => {
        if (!isFullscreen) return
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsFullscreen(false)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isFullscreen])

    // Dynamic nodes and connections state
    const [nodes, setNodes] = useState<FlowNode[]>([])
    const [connections, setConnections] = useState<Connection[]>([])

    // Active dragging line state
    const [draggedLink, setDraggedLink] = useState<{
        fromNodeId: string
        fromPortX: number
        fromPortY: number
        currentX: number
        currentY: number
    } | null>(null)

    // Sidebar drawer template editor states
    const [editingNode, setEditingNode] = useState<FlowNode | null>(null)
    const [drawerText, setDrawerText] = useState('')
    const [drawerButtons, setDrawerButtons] = useState<ActionButton[][]>([])
    const [drawerTab, setDrawerTab] = useState<'visual' | 'code'>('visual')
    const [showEmojis, setShowEmojis] = useState(false)
    const [showFields, setShowFields] = useState(false)
    const [showCondBuilder, setShowCondBuilder] = useState(false)
    const [showLinkBuilder, setShowLinkBuilder] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saveSuccess, setSaveSuccess] = useState(false)

    // Conditional Builder Form
    const [condField, setCondField] = useState('paymentMethodRaw')
    const [condOperator, setCondOperator] = useState('==')
    const [condValue, setCondValue] = useState('')
    const [condTrueText, setCondTrueText] = useState('')
    const [condFalseText, setCondFalseText] = useState('')

    // WA Link Builder
    const [linkText, setLinkText] = useState('')
    const [linkUrl, setLinkUrl] = useState('')

    const visualEditorRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const lastEmittedRef = useRef<string>('')
    const savedRangeRef = useRef<Range | null>(null)

    // Dropdown references
    const emojiRef = useRef<HTMLDivElement>(null)
    const fieldsRef = useRef<HTMLDivElement>(null)
    const condRef = useRef<HTMLDivElement>(null)
    const linkRef = useRef<HTMLDivElement>(null)

    // Floating add node menu
    const [showAddMenu, setShowAddMenu] = useState(false)
    const [addMenuPos, setAddMenuPos] = useState({ x: 100, y: 100 })

    // Close dropdowns on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmojis(false)
            if (fieldsRef.current && !fieldsRef.current.contains(e.target as Node)) setShowFields(false)
            if (condRef.current && !condRef.current.contains(e.target as Node)) setShowCondBuilder(false)
            if (linkRef.current && !linkRef.current.contains(e.target as Node)) setShowLinkBuilder(false)
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // Initialize Layout: merge active Firestore templates with LocalStorage positions
    useEffect(() => {
        const savedLayoutRaw = localStorage.getItem('fuddi_telegram_flow_layout')
        let layoutNodes: FlowNode[] = []
        let layoutConnections: Connection[] = []

        if (savedLayoutRaw) {
            try {
                const parsed = JSON.parse(savedLayoutRaw)
                layoutNodes = parsed.nodes || []
                layoutConnections = parsed.connections || []
            } catch (e) {
                console.error('Failed to parse saved layout', e)
            }
        }

        // If layout doesn't exist, build default columns
        const defaultTriggers = Object.keys(EVENT_INFOS)
        const activeDbKeys = Object.keys(templates).filter(key => templates[key]?.trim().length > 0)

        // Find all templates that are customized in Firestore or are standard defaults
        const templateKeysToCreate = Array.from(new Set([
            ...activeDbKeys,
            'store_new_order',
            'delivery_assigned',
            'customer_confirmed',
            'store_reminder'
        ]))

        const initialNodes: FlowNode[] = []
        const initialConnections: Connection[] = []

        // Generate triggers
        defaultTriggers.forEach((triggerKey, index) => {
            const savedNode = layoutNodes.find(n => n.id === `trigger_${triggerKey}`)
            initialNodes.push({
                id: `trigger_${triggerKey}`,
                type: 'trigger',
                key: triggerKey,
                label: EVENT_INFOS[triggerKey].label,
                icon: EVENT_INFOS[triggerKey].icon,
                category: EVENT_INFOS[triggerKey].category,
                x: savedNode?.x ?? 80,
                y: savedNode?.y ?? (index * 160 + 80),
            })
        })

        // Generate action nodes for templates
        templateKeysToCreate.forEach((tplKey, index) => {
            const split = tplKey.split('_')
            const recipient = split[0] as Recipient
            // Find event key
            let event = split.slice(1).join('_')
            // Special handler: confirmed has entry vs update versions
            if (event === 'confirmed' && recipient === 'customer') {
                event = 'confirmed_entry'
            }

            const actionNodeId = `action_${tplKey}`
            const savedNode = layoutNodes.find(n => n.id === actionNodeId)

            initialNodes.push({
                id: actionNodeId,
                type: 'action',
                key: recipient,
                label: `Enviar a ${RECIPIENT_INFOS[recipient]?.label || recipient}`,
                icon: RECIPIENT_INFOS[recipient]?.icon || 'bi-telegram',
                boundEventKey: event,
                x: savedNode?.x ?? 600,
                y: savedNode?.y ?? (index * 180 + 120),
            })

            // Generate connection
            initialConnections.push({
                id: `trigger_${event}-action_${tplKey}`,
                fromId: `trigger_${event}`,
                toId: actionNodeId
            })
        })

        // Merge any remaining user-created custom nodes from layout
        layoutNodes.forEach(ln => {
            if (!initialNodes.some(n => n.id === ln.id)) {
                initialNodes.push(ln)
            }
        })
        layoutConnections.forEach(lc => {
            if (!initialConnections.some(c => c.id === lc.id)) {
                // Verify ports still exist
                if (initialNodes.some(n => n.id === lc.fromId) && initialNodes.some(n => n.id === lc.toId)) {
                    initialConnections.push(lc)
                }
            }
        })

        setNodes(initialNodes)
        setConnections(initialConnections)
    }, [templates])

    // Save node positions in LocalStorage
    const saveLayout = (updatedNodes: FlowNode[], updatedConns: Connection[]) => {
        localStorage.setItem('fuddi_telegram_flow_layout', JSON.stringify({
            nodes: updatedNodes.map(n => ({ id: n.id, x: n.x, y: n.y, type: n.type, key: n.key, label: n.label, icon: n.icon, category: n.category, boundEventKey: n.boundEventKey })),
            connections: updatedConns
        }))
    }

    // Canvas Navigation
    const handleCanvasMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return // Only left-click
        const isBg = e.target === canvasRef.current || (svgRef.current && e.target === svgRef.current)
        if (!isBg) return
        
        setIsPanning(true)
        const startX = e.clientX - pan.x
        const startY = e.clientY - pan.y

        const handleMouseMove = (moveEvent: MouseEvent) => {
            setPan({
                x: moveEvent.clientX - startX,
                y: moveEvent.clientY - startY,
            })
        }

        const handleMouseUp = () => {
            setIsPanning(false)
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault()
        if (e.ctrlKey) {
            // Zoom with Ctrl key held down
            const zoomFactor = 0.05
            const direction = e.deltaY < 0 ? 1 : -1
            let newZoom = zoom + direction * zoomFactor
            newZoom = Math.max(0.4, Math.min(newZoom, 1.6))
            setZoom(newZoom)
        } else {
            // Normal scroll pans the canvas
            setPan(prev => ({
                x: prev.x - e.deltaX,
                y: prev.y - e.deltaY
            }))
        }
    }

    // Zoom Controls
    const zoomIn = () => setZoom(z => Math.min(1.6, z + 0.1))
    const zoomOut = () => setZoom(z => Math.max(0.4, z - 0.1))
    const resetZoom = () => {
        setZoom(0.95)
        setPan({ x: 50, y: 50 })
    }

    // Draggable Nodes
    const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
        e.stopPropagation()
        if (e.button !== 0) return
        
        const startX = e.clientX
        const startY = e.clientY
        const node = nodes.find(n => n.id === nodeId)
        if (!node) return
        const initialPos = { x: node.x, y: node.y }

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const dx = (moveEvent.clientX - startX) / zoom
            const dy = (moveEvent.clientY - startY) / zoom
            setNodes(prev => {
                const updated = prev.map(n => n.id === nodeId ? { ...n, x: initialPos.x + dx, y: initialPos.y + dy } : n)
                saveLayout(updated, connections)
                return updated
            })
        }

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    // ─── PORTS & LINKING ─────────────────────────────────────────
    const handleOutputPortMouseDown = (e: React.MouseEvent, nodeId: string) => {
        e.stopPropagation()
        e.preventDefault()
        
        const node = nodes.find(n => n.id === nodeId)
        if (!node) return

        // Output port coordinate
        const cardWidth = 260
        const portOffsetY = 42
        const startX = node.x + cardWidth
        const startY = node.y + portOffsetY

        // Calculate mouse position relative to canvas
        const rect = canvasRef.current!.getBoundingClientRect()
        const initialMouseX = (e.clientX - rect.left - pan.x) / zoom
        const initialMouseY = (e.clientY - rect.top - pan.y) / zoom

        setDraggedLink({
            fromNodeId: nodeId,
            fromPortX: startX,
            fromPortY: startY,
            currentX: initialMouseX,
            currentY: initialMouseY
        })

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const mouseX = (moveEvent.clientX - rect.left - pan.x) / zoom
            const mouseY = (moveEvent.clientY - rect.top - pan.y) / zoom
            setDraggedLink(prev => prev ? { ...prev, currentX: mouseX, currentY: mouseY } : null)
        }

        const handleMouseUp = () => {
            setDraggedLink(null)
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    const handleInputPortMouseUp = (e: React.MouseEvent, targetNodeId: string) => {
        e.stopPropagation()
        if (!draggedLink) return

        const sourceNodeId = draggedLink.fromNodeId
        const sourceNode = nodes.find(n => n.id === sourceNodeId)
        const targetNode = nodes.find(n => n.id === targetNodeId)

        if (!sourceNode || !targetNode) return

        // Verify connecting Trigger to Action
        if (sourceNode.type !== 'trigger' || targetNode.type !== 'action') {
            alert('Solo puedes conectar un Disparador (Trigger) a una Acción (Destinatario).')
            return
        }

        // Validate recipient support
        const eventKey = sourceNode.key
        const recipient = targetNode.key as Recipient
        
        // Normalize event key to match keys in EVENT_INFOS
        let normalEventKey = eventKey
        if (eventKey === 'confirmed' && sourceNode.category === 'entry') {
            normalEventKey = 'confirmed_entry'
        }

        const eventInfo = EVENT_INFOS[normalEventKey]
        if (!eventInfo) return

        if (!eventInfo.validRecipients.includes(recipient)) {
            alert(`El destinatario ${RECIPIENT_INFOS[recipient].label} no es válido para el evento: "${eventInfo.label}".`)
            return
        }

        // Check if connection already exists
        const connId = `${sourceNodeId}-${targetNodeId}`
        if (connections.some(c => c.id === connId)) return

        // Establish connection
        const newConnection = { id: connId, fromId: sourceNodeId, toId: targetNodeId }
        const updatedConns = [...connections, newConnection]

        // Bind the Action Node to this Event
        const updatedNodes = nodes.map(n => {
            if (n.id === targetNodeId) {
                return { ...n, boundEventKey: eventKey }
            }
            return n
        })

        setNodes(updatedNodes)
        setConnections(updatedConns)
        saveLayout(updatedNodes, updatedConns)

        // Prepopulate template if not configured
        const tplKey = `${recipient}_${eventKey}`
        if (!templates[tplKey] && DEFAULT_TEMPLATES[tplKey]) {
            onSave(recipient, eventKey, DEFAULT_TEMPLATES[tplKey], DEFAULT_BUTTONS[tplKey] || undefined)
        }
    }

    // Delete a connection (deactivates template)
    const deleteConnection = (connId: string) => {
        const conn = connections.find(c => c.id === connId)
        if (!conn) return

        const actionNode = nodes.find(n => n.id === conn.toId)
        const triggerNode = nodes.find(n => n.id === conn.fromId)
        
        if (actionNode && triggerNode) {
            const recipient = actionNode.key as Recipient
            const event = triggerNode.key
            const tplKey = `${recipient}_${event}`

            if (confirm(`¿Estás seguro de que deseas desactivar esta plantilla?\nSe eliminará el diseño personalizado de ${RECIPIENT_INFOS[recipient].label} para el evento ${EVENT_INFOS[event]?.label || event}.`)) {
                onDelete(recipient, event)
                
                // Remove connection
                const updatedConns = connections.filter(c => c.id !== connId)
                
                // Unbind Action Node
                const updatedNodes = nodes.map(n => {
                    if (n.id === conn.toId) {
                        return { ...n, boundEventKey: undefined }
                    }
                    return n
                })

                setNodes(updatedNodes)
                setConnections(updatedConns)
                saveLayout(updatedNodes, updatedConns)
            }
        }
    }

    // Delete a Node
    const deleteNode = (nodeId: string) => {
        const node = nodes.find(n => n.id === nodeId)
        if (!node) return

        if (confirm(`¿Quieres remover la tarjeta "${node.label}" del canvas?`)) {
            // Find connections to/from this node
            const affectedConns = connections.filter(c => c.fromId === nodeId || c.toId === nodeId)
            
            // If they are action templates, prompt database delete
            affectedConns.forEach(c => {
                const trg = nodes.find(n => n.id === c.fromId)
                const act = nodes.find(n => n.id === c.toId)
                if (trg && act) {
                    onDelete(act.key as Recipient, trg.key)
                }
            })

            const updatedNodes = nodes.filter(n => n.id !== nodeId)
            const updatedConns = connections.filter(c => c.fromId !== nodeId && c.toId !== nodeId)

            setNodes(updatedNodes)
            setConnections(updatedConns)
            saveLayout(updatedNodes, updatedConns)
        }
    }

    // Add Node UI Menu
    const handleCanvasContextMenu = (e: React.MouseEvent) => {
        e.preventDefault()
        const rect = canvasRef.current!.getBoundingClientRect()
        setAddMenuPos({
            x: (e.clientX - rect.left - pan.x) / zoom,
            y: (e.clientY - rect.top - pan.y) / zoom
        })
        setShowAddMenu(true)
    }

    const addNewTriggerNode = (eventKey: string) => {
        const newId = `trigger_${eventKey}_${Date.now()}`
        const info = EVENT_INFOS[eventKey]
        const newNode: FlowNode = {
            id: newId,
            type: 'trigger',
            key: eventKey,
            label: info.label,
            icon: info.icon,
            category: info.category,
            x: addMenuPos.x,
            y: addMenuPos.y
        }
        const updated = [...nodes, newNode]
        setNodes(updated)
        saveLayout(updated, connections)
        setShowAddMenu(false)
    }

    const addNewActionNode = (recipient: Recipient) => {
        const newId = `action_${recipient}_${Date.now()}`
        const info = RECIPIENT_INFOS[recipient]
        const newNode: FlowNode = {
            id: newId,
            type: 'action',
            key: recipient,
            label: `Enviar a ${info.label}`,
            icon: info.icon,
            x: addMenuPos.x,
            y: addMenuPos.y
        }
        const updated = [...nodes, newNode]
        setNodes(updated)
        saveLayout(updated, connections)
        setShowAddMenu(false)
    }

    // ─── TEMPLATE EDITOR DRAWER ──────────────────────────────────
    const openEditorDrawer = (node: FlowNode) => {
        if (node.type !== 'action' || !node.boundEventKey) {
            alert('Conecta primero este destinatario a un Disparador para editar la plantilla.')
            return
        }

        const recipient = node.key as Recipient
        const event = node.boundEventKey
        const tplKey = `${recipient}_${event}`

        setEditingNode(node)
        setDrawerText(templates[tplKey] || DEFAULT_TEMPLATES[tplKey] || '')
        setDrawerButtons(templateButtons[tplKey] || DEFAULT_BUTTONS[tplKey] || [])
        setDrawerTab('visual')
        
        // Reset drawer form elements
        setCondTrueText('')
        setCondFalseText('')
        setLinkText('')
        setLinkUrl('')
    }

    const closeEditorDrawer = () => {
        setEditingNode(null)
    }

    // Visual Editor Tokenizer & Ref builder
    const rebuildVisualDOM = useCallback((template: string) => {
        const el = visualEditorRef.current
        if (!el) return
        el.innerHTML = ''
        const tokens = visualTokenize(template)
        el.appendChild(buildVisualFragment(tokens, (tok) => handleCondClick(tok)))
    }, [])

    useEffect(() => {
        if (editingNode && drawerTab === 'visual') {
            requestAnimationFrame(() => {
                if (visualEditorRef.current) {
                    lastEmittedRef.current = drawerText
                    rebuildVisualDOM(drawerText)
                    savedRangeRef.current = null
                }
            })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editingNode, drawerTab])

    const getVisualRange = useCallback((): Range | null => {
        const el = visualEditorRef.current
        if (!el) return null
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            return sel.getRangeAt(0).cloneRange()
        }
        if (savedRangeRef.current) return savedRangeRef.current.cloneRange()
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        return range
    }, [])

    const applyRange = useCallback((range: Range) => {
        savedRangeRef.current = range
        const el = visualEditorRef.current
        if (!el) return
        el.focus()
        const sel = window.getSelection()
        if (sel) { sel.removeAllRanges(); sel.addRange(range) }
    }, [])

    const insertAtCursor = useCallback((text: string) => {
        if (drawerTab === 'visual') {
            const el = visualEditorRef.current
            if (!el) return
            const range = getVisualRange()
            if (!range) return
            const newRange = ceInsertTextAt(text, range)
            applyRange(newRange)
            
            const raw = extractVisualTemplate(el)
            lastEmittedRef.current = raw
            setDrawerText(raw)
            return
        }
        // Area Raw Textarea fallback
        const ta = textareaRef.current
        if (!ta) return
        ta.focus()
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const newVal = ta.value.substring(0, start) + text + ta.value.substring(end)
        setDrawerText(newVal)
        requestAnimationFrame(() => {
            ta.focus()
            ta.setSelectionRange(start + text.length, start + text.length)
        })
    }, [drawerTab, getVisualRange, applyRange])

    const wrapSelection = useCallback((tag: string) => {
        if (drawerTab === 'visual') {
            const el = visualEditorRef.current
            if (!el) return
            const range = getVisualRange()
            if (!range) return
            const newRange = ceWrapSelectionAt(tag, range)
            applyRange(newRange)
            const raw = extractVisualTemplate(el)
            lastEmittedRef.current = raw
            setDrawerText(raw)
            return
        }
        const ta = textareaRef.current
        if (!ta) return
        ta.focus()
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const selected = ta.value.substring(start, end)
        const wrapped = selected ? `<${tag}>${selected}</${tag}>` : `<${tag}></${tag}>`
        const newVal = ta.value.substring(0, start) + wrapped + ta.value.substring(end)
        setDrawerText(newVal)
        requestAnimationFrame(() => {
            ta.focus()
            ta.setSelectionRange(start + (tag.length + 2), start + wrapped.length - (tag.length + 3))
        })
    }, [drawerTab, getVisualRange, applyRange])

    // Cond block insertion
    const insertConditionalBlock = () => {
        let block = `{{#if ${condField}`
        if (condValue) {
            block += ` ${condOperator} "${condValue}"`
        }
        block += `}}${condTrueText}`
        if (condFalseText) {
            block += `{{else}}${condFalseText}`
        }
        block += `{{/if}}`

        insertAtCursor(block)
        setShowCondBuilder(false)
        setCondTrueText('')
        setCondFalseText('')
        setCondValue('')
    }

    // Link insertion
    const insertWAUrl = () => {
        if (!linkUrl) return
        const fullTag = `<a href="${linkUrl}">${linkText || 'Ver enlace'}</a>`
        insertAtCursor(fullTag)
        setShowLinkBuilder(false)
        setLinkUrl('')
        setLinkText('')
    }

    const handleCondClick = (tok: any) => {
        setCondField(tok.field)
        if (tok.operator) setCondOperator(tok.operator)
        if (tok.value) setCondValue(tok.value)
        setCondTrueText(tok.contentTrue)
        setCondFalseText(tok.contentFalse)
        setShowCondBuilder(true)
    }

    // Telegram buttons rows management
    const addButtonRow = () => {
        setDrawerButtons(prev => [...prev, []])
    }

    const removeButtonRow = (rowIndex: number) => {
        setDrawerButtons(prev => prev.filter((_, i) => i !== rowIndex))
    }

    const addButtonToRow = (rowIndex: number) => {
        setDrawerButtons(prev => prev.map((row, i) => {
            if (i === rowIndex) {
                return [...row, { text: 'Nuevo Botón', type: 'callback', value: 'custom_callback' }]
            }
            return row
        }))
    }

    const removeButtonFromRow = (rowIndex: number, btnIndex: number) => {
        setDrawerButtons(prev => prev.map((row, r) => {
            if (r === rowIndex) {
                return row.filter((_, b) => b !== btnIndex)
            }
            return row
        }))
    }

    const updateButton = (rowIndex: number, btnIndex: number, fields: Partial<ActionButton>) => {
        setDrawerButtons(prev => prev.map((row, r) => {
            if (r === rowIndex) {
                return row.map((btn, b) => b === btnIndex ? { ...btn, ...fields } : btn)
            }
            return row
        }))
    }

    const saveTemplateChanges = async () => {
        if (!editingNode || !editingNode.boundEventKey) return

        setSaving(true)
        const recipient = editingNode.key as Recipient
        const event = editingNode.boundEventKey

        try {
            // Clean empty rows or empty button texts
            const cleanedButtons = drawerButtons
                .map(row => row.filter(b => b.text.trim().length > 0))
                .filter(row => row.length > 0)

            await onSave(recipient, event, drawerText, cleanedButtons.length > 0 ? cleanedButtons : undefined)
            setSaveSuccess(true)
            setTimeout(() => setSaveSuccess(false), 2000)
            closeEditorDrawer()
        } catch (e) {
            console.error(e)
            alert('Error al guardar la plantilla en Firestore.')
        } finally {
            setSaving(false)
        }
    }

    // ─── INSTANT TELEGRAM RENDER PREVIEW ──────────────────────────
    const renderPreview = () => {
        let preview = drawerText

        // Build simple fields variables mapping for preview
        const exampleVars: Record<string, string> = {}
        AVAILABLE_FIELDS.forEach(f => {
            exampleVars[f.key] = f.example
        })

        // Process conditional blocks: {{#if condition}} content [{{else}} alternative] {{/if}}
        const ifRegex = /\{\{#if\s+([\w.]+)(?:\s*(==|!=|contains)\s*(?:'([^']*)'|"([^"]*)"))?\s*\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g
        preview = preview.replace(ifRegex, (match, variable, operator, val1, val2, content, alternative) => {
            const varValue = exampleVars[variable]
            const compareValue = val1 || val2
            let html = ''

            if (content && content.trim()) {
                const badgeTrue = `<span class="inline-flex text-[9px] font-bold bg-green-500 text-white px-1.5 py-0.5 rounded mr-1">SI: ${variable} ${operator || ''} ${compareValue || ''}</span>`
                html += `<div class="border-l-2 border-green-500 pl-2 bg-green-50/50 py-1 my-1">${badgeTrue}${content}</div>`
            }

            if (alternative && alternative.trim()) {
                const badgeFalse = `<span class="inline-flex text-[9px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded mr-1">SINO</span>`
                html += `<div class="border-l-2 border-red-500 pl-2 bg-red-50/50 py-1 my-1">${badgeFalse}${alternative}</div>`
            }

            return html
        })

        // Replace placeholders with sky-colored text
        AVAILABLE_FIELDS.forEach(field => {
            const regex = new RegExp(`\\{\\{${field.key}\\}\\}`, 'g')
            preview = preview.replace(regex, `<span class="text-sky-500 font-semibold">${field.example}</span>`)
        })

        // Fallbacks for missing tags
        preview = preview.replace(/\{\{(\w+)\}\}/g, '<span class="text-amber-500 font-semibold">{{$1}}</span>')

        // Convert breaks
        preview = preview.replace(/\n/g, '<br/>')

        return preview
    }

    // ─── SVG BEZIER MATH ─────────────────────────────────────────
    const getBezierPath = (x1: number, y1: number, x2: number, y2: number) => {
        const dx = Math.abs(x2 - x1) * 0.45
        return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
    }

    return (
        <div className={isFullscreen
            ? "fixed inset-0 z-[100] w-screen h-screen bg-slate-50 select-none overflow-hidden"
            : "relative w-full h-[calc(100vh-230px)] min-h-[650px] bg-slate-50 border border-gray-200 rounded-2xl overflow-hidden shadow-inner select-none"
        }>
            {/* Canvas Navigation Toolbar */}
            <div className="absolute top-4 left-4 flex gap-1 bg-white p-2 rounded-xl border border-gray-200 shadow-sm z-30">
                <button onClick={zoomIn} className="p-2 rounded-lg hover:bg-slate-100 text-gray-700 transition-colors" title="Acercar">
                    <i className="bi bi-zoom-in text-base"></i>
                </button>
                <button onClick={zoomOut} className="p-2 rounded-lg hover:bg-slate-100 text-gray-700 transition-colors" title="Alejar">
                    <i className="bi bi-zoom-out text-base"></i>
                </button>
                <button onClick={resetZoom} className="p-2 rounded-lg hover:bg-slate-100 text-gray-700 transition-colors" title="Restaurar Vista">
                    <i className="bi bi-arrows-angle-contract text-base"></i>
                </button>
                <button
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    className="p-2 rounded-lg hover:bg-slate-100 text-gray-700 transition-colors"
                    title={isFullscreen ? "Salir de pantalla completa (Esc)" : "Pantalla completa"}
                >
                    <i className={`bi bi-${isFullscreen ? 'fullscreen-exit' : 'fullscreen'} text-base`}></i>
                </button>
                <div className="w-px h-6 bg-gray-200 mx-1"></div>
                <div className="flex items-center text-xs font-semibold text-gray-500 px-1">
                    {Math.round(zoom * 100)}%
                </div>
            </div>

            {/* Float Help Tip */}
            <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-sm px-4 py-2.5 rounded-xl border border-gray-200 shadow-sm z-30 max-w-sm hidden md:block">
                <div className="flex items-start gap-2">
                    <i className="bi bi-info-circle text-blue-500 mt-0.5"></i>
                    <p className="text-[11px] text-gray-500 leading-normal font-medium">
                        <b>Consejo:</b> Arrastra un puerto de salida <span className="w-2 h-2 inline-block rounded-full bg-blue-500"></span> (derecha) hacia un puerto de entrada (izquierda) para conectar. Doble click en un destinatario para editar el mensaje. Click derecho en el fondo para añadir tarjetas.
                    </p>
                </div>
            </div>

            {/* Add Node UI Menu Trigger Button */}
            <div className="absolute bottom-4 left-4 z-30">
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        const rect = canvasRef.current!.getBoundingClientRect()
                        setAddMenuPos({ x: (rect.width / 2 - pan.x) / zoom, y: (rect.height / 2 - pan.y) / zoom })
                        setShowAddMenu(!showAddMenu)
                    }}
                    className="flex items-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md shadow-blue-200 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                    <i className="bi bi-plus-circle text-base"></i>
                    Añadir Tarjeta
                </button>
            </div>

            {/* Infinite Canvas */}
            <div
                ref={canvasRef}
                onMouseDown={handleCanvasMouseDown}
                onWheel={handleWheel}
                onContextMenu={handleCanvasContextMenu}
                className={`w-full h-full relative overflow-hidden bg-slate-50 cursor-grab ${isPanning ? 'cursor-grabbing' : ''}`}
                style={{
                    backgroundImage: 'radial-gradient(#cbd5e1 1.2px, transparent 1.2px)',
                    backgroundSize: '24px 24px',
                    backgroundPosition: `${pan.x}px ${pan.y}px`
                }}
            >
                {/* Scale & Pan Wrapper */}
                <div
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: '0 0',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        pointerEvents: 'none'
                    }}
                >
                    {/* SVG Connector Lines Layer */}
                    <svg
                        ref={svgRef}
                        className="absolute inset-0 w-[5000px] h-[5000px] pointer-events-auto overflow-visible"
                        style={{ zIndex: 1 }}
                    >
                        <defs>
                            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                <path d="M 0 1 L 10 5 L 0 9 z" fill="#3b82f6" />
                            </marker>
                            <marker id="arrow-inactive" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                <path d="M 0 1 L 10 5 L 0 9 z" fill="#94a3b8" />
                            </marker>
                        </defs>

                        {/* Existing connections */}
                        {connections.map(conn => {
                            const fromNode = nodes.find(n => n.id === conn.fromId)
                            const toNode = nodes.find(n => n.id === conn.toId)
                            if (!fromNode || !toNode) return null

                            // Port Coordinate Maths
                            const cardWidth = 260
                            const portY = 42
                            const startX = fromNode.x + cardWidth
                            const startY = fromNode.y + portY
                            const endX = toNode.x
                            const endY = toNode.y + portY

                            const d = getBezierPath(startX, startY, endX, endY)
                            
                            // Check if template is active in Firestore
                            const tplKey = `${toNode.key}_${fromNode.key}`
                            const isSaved = !!templates[tplKey]

                            return (
                                <g key={conn.id} className="group pointer-events-auto cursor-pointer">
                                    {/* Transparent thick click target */}
                                    <path
                                        d={d}
                                        fill="none"
                                        stroke="transparent"
                                        strokeWidth={16}
                                        onClick={() => openEditorDrawer(toNode)}
                                    />
                                    {/* Rendered line */}
                                    <path
                                        d={d}
                                        fill="none"
                                        stroke={isSaved ? '#3b82f6' : '#94a3b8'}
                                        strokeWidth={isSaved ? 3 : 2}
                                        className={isSaved ? 'connection-line-active' : ''}
                                        style={{
                                            strokeDasharray: isSaved ? 'none' : '4 4',
                                            transition: 'stroke 0.2s'
                                        }}
                                        markerEnd={isSaved ? "url(#arrow)" : "url(#arrow-inactive)"}
                                    />
                                    {/* Pulse effect for configured notifications */}
                                    {isSaved && (
                                        <path
                                            d={d}
                                            fill="none"
                                            stroke="#60a5fa"
                                            strokeWidth={3}
                                            opacity={0.6}
                                            strokeDasharray="6 12"
                                            className="animate-[flow_1.2s_linear_infinite]"
                                            style={{
                                                animation: 'flow 1.5s linear infinite'
                                            }}
                                        />
                                    )}

                                    {/* Delete Connection overlay */}
                                    <foreignObject
                                        x={(startX + endX) / 2 - 14}
                                        y={(startY + endY) / 2 - 14}
                                        width={28}
                                        height={28}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                deleteConnection(conn.id)
                                            }}
                                            className="w-7 h-7 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-md text-xs border border-white font-bold"
                                            title="Desactivar Plantilla"
                                        >
                                            <i className="bi bi-x"></i>
                                        </button>
                                    </foreignObject>
                                </g>
                            )
                        })}

                        {/* Active link drawing */}
                        {draggedLink && (
                            <path
                                d={getBezierPath(draggedLink.fromPortX, draggedLink.fromPortY, draggedLink.currentX, draggedLink.currentY)}
                                fill="none"
                                stroke="#3b82f6"
                                strokeWidth={2.5}
                                strokeDasharray="4 4"
                                markerEnd="url(#arrow)"
                            />
                        )}
                    </svg>

                    {/* Nodes Layer */}
                    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
                        {nodes.map(node => {
                            const isTrigger = node.type === 'trigger'
                            const cardWidth = 260
                            const isSaved = !isTrigger && node.boundEventKey ? !!templates[`${node.key}_${node.boundEventKey}`] : false

                            return (
                                <div
                                    key={node.id}
                                    className={`absolute bg-white rounded-2xl border transition-shadow shadow-sm hover:shadow-md pointer-events-auto flex flex-col`}
                                    style={{
                                        left: node.x,
                                        top: node.y,
                                        width: cardWidth,
                                        borderWidth: '1.5px',
                                        borderColor: isTrigger
                                            ? node.category === 'entry' ? '#bfdbfe' : '#fef3c7'
                                            : RECIPIENT_INFOS[node.key as Recipient]?.border || '#e2e8f0'
                                    }}
                                    onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                                    onDoubleClick={() => !isTrigger && openEditorDrawer(node)}
                                >
                                    {/* Card Header */}
                                    <div
                                        className={`px-4 py-3 rounded-t-2xl flex items-center justify-between border-b cursor-grab active:cursor-grabbing ${
                                            isTrigger
                                                ? node.category === 'entry' ? 'bg-blue-50/70 border-blue-100' : 'bg-amber-50/70 border-amber-100'
                                                : RECIPIENT_INFOS[node.key as Recipient]?.bg || 'bg-slate-50'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 truncate">
                                            <div className={`p-1 rounded-lg bg-white border border-gray-100 shadow-sm flex items-center justify-center w-6 h-6`}>
                                                <i className={`bi ${node.icon} ${
                                                    isTrigger
                                                        ? node.category === 'entry' ? 'text-blue-500' : 'text-amber-500'
                                                        : RECIPIENT_INFOS[node.key as Recipient]?.color || 'text-gray-500'
                                                } text-[11px]`}></i>
                                            </div>
                                            <span className="text-xs font-bold text-gray-800 truncate">{node.label}</span>
                                        </div>
                                        {/* Card delete button */}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); deleteNode(node.id) }}
                                            className="w-5 h-5 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-slate-100 transition-colors"
                                        >
                                            <i className="bi bi-trash text-xs"></i>
                                        </button>
                                    </div>

                                    {/* Card Body */}
                                    <div className="px-4 py-3 flex-1 flex flex-col justify-between min-h-[50px]">
                                        {isTrigger ? (
                                            <div>
                                                <p className="text-[10px] text-gray-400 leading-normal">
                                                    {EVENT_INFOS[node.key]?.desc || 'Disparador de evento'}
                                                </p>
                                                <span className={`inline-block mt-2 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                                                    node.category === 'entry'
                                                        ? 'bg-blue-100 text-blue-700'
                                                        : 'bg-amber-100 text-amber-700'
                                                }`}>
                                                    {node.category === 'entry' ? 'Entrada' : 'Actualización'}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {node.boundEventKey ? (
                                                    <>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[9px] text-gray-400">Trigger: {EVENT_INFOS[node.boundEventKey]?.label || node.boundEventKey}</span>
                                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                                                isSaved ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                                                            }`}>
                                                                {isSaved ? 'Configurada' : 'Default'}
                                                            </span>
                                                        </div>
                                                        <p className="text-[10px] text-gray-500 font-mono line-clamp-2 bg-slate-50 border border-slate-100 rounded-lg p-1.5 max-h-[42px] leading-relaxed">
                                                            {templates[`${node.key}_${node.boundEventKey}`] || DEFAULT_TEMPLATES[`${node.key}_${node.boundEventKey}`] || 'Mensaje vacío...'}
                                                        </p>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); openEditorDrawer(node) }}
                                                            className="mt-1 w-full py-1.5 border border-blue-500/20 hover:border-blue-500/40 bg-blue-50/20 hover:bg-blue-50/50 text-blue-600 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                                                        >
                                                            <i className="bi bi-pencil-square"></i>
                                                            Editar Mensaje
                                                        </button>
                                                    </>
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center py-2 border-2 border-dashed border-gray-100 rounded-xl">
                                                        <p className="text-[10px] text-gray-400 italic">Sin disparador</p>
                                                        <p className="text-[8px] text-gray-400 mt-0.5">Conéctame a un evento</p>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Output Port (Triggers right edge) */}
                                    {isTrigger && (
                                        <div
                                            className="absolute -right-2 top-[34px] w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-crosshair flex items-center justify-center hover:scale-125 hover:bg-blue-50 transition-transform"
                                            onMouseDown={(e) => handleOutputPortMouseDown(e, node.id)}
                                            title="Arrastra para conectar"
                                        >
                                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                                        </div>
                                    )}

                                    {/* Input Port (Actions left edge) */}
                                    {!isTrigger && (
                                        <div
                                            className="absolute -left-2 top-[34px] w-4 h-4 bg-white border-2 border-gray-400 rounded-full cursor-pointer flex items-center justify-center hover:scale-125 hover:border-blue-500 transition-all"
                                            onMouseUp={(e) => handleInputPortMouseUp(e, node.id)}
                                            title="Suelte para conectar"
                                        >
                                            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full hover:bg-blue-500"></div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>

            {/* Context menu for adding cards */}
            {showAddMenu && (
                <div
                    className="absolute bg-white rounded-xl shadow-2xl border border-gray-200 py-2 w-64 z-[40]"
                    style={{
                        left: addMenuPos.x * zoom + pan.x,
                        top: addMenuPos.y * zoom + pan.y
                    }}
                >
                    <div className="px-3 py-1.5 border-b border-gray-100 flex items-center justify-between bg-slate-50 rounded-t-xl">
                        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Añadir Tarjeta</h4>
                        <button onClick={() => setShowAddMenu(false)} className="text-gray-400 hover:text-gray-600">
                            <i className="bi bi-x text-xs"></i>
                        </button>
                    </div>
                    
                    {/* Disparadores */}
                    <div className="max-h-60 overflow-y-auto">
                        <div className="px-3 py-1 bg-slate-50 text-[9px] font-bold text-gray-500">DISPARADORES (EVENTOS)</div>
                        {Object.keys(EVENT_INFOS).map(key => (
                            <button
                                key={key}
                                onClick={() => addNewTriggerNode(key)}
                                className="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-xs text-gray-700 flex items-center gap-2"
                            >
                                <i className={`bi ${EVENT_INFOS[key].icon}`}></i>
                                {EVENT_INFOS[key].label}
                            </button>
                        ))}

                        {/* Acciones */}
                        <div className="px-3 py-1 bg-slate-50 text-[9px] font-bold text-gray-500 mt-1">ACCIONES (MENSAJES)</div>
                        {(['store', 'delivery', 'customer', 'admin'] as Recipient[]).map(rec => (
                            <button
                                key={rec}
                                onClick={() => addNewActionNode(rec)}
                                className="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-xs text-gray-700 flex items-center gap-2"
                            >
                                <i className={`bi ${RECIPIENT_INFOS[rec].icon}`}></i>
                                Enviar a {RECIPIENT_INFOS[rec].label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ─── TEMPLATE EDITOR SLIDE-OVER DRAWER ────────────────────── */}
            {editingNode && editingNode.boundEventKey && (
                <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs z-40 transition-all pointer-events-auto flex justify-end">
                    {/* Slide content container */}
                    <div className="w-[580px] bg-white h-full shadow-2xl flex flex-col relative">
                        
                        {/* Drawer Header */}
                        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-slate-50">
                            <div>
                                <h3 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                                    <i className="bi bi-telegram text-blue-500"></i>
                                    Editar Mensaje de Telegram
                                </h3>
                                <p className="text-[11px] text-gray-400 mt-0.5">
                                    Disparador: <b>{EVENT_INFOS[editingNode.boundEventKey]?.label || editingNode.boundEventKey}</b> → Destinatario: <b>{RECIPIENT_INFOS[editingNode.key as Recipient]?.label}</b>
                                </p>
                            </div>
                            <button
                                onClick={closeEditorDrawer}
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-500 transition-colors"
                            >
                                <i className="bi bi-x-lg text-sm"></i>
                            </button>
                        </div>

                        {/* Drawer body - Scrollable */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            
                            {/* Editor Mode Tabs */}
                            <div className="flex bg-slate-100 p-1 rounded-xl">
                                <button
                                    onClick={() => setDrawerTab('visual')}
                                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                                        drawerTab === 'visual' ? 'bg-white text-gray-800 shadow-xs' : 'text-gray-500 hover:text-gray-800'
                                    }`}
                                >
                                    Editor Visual
                                </button>
                                <button
                                    onClick={() => setDrawerTab('code')}
                                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                                        drawerTab === 'code' ? 'bg-white text-gray-800 shadow-xs' : 'text-gray-500 hover:text-gray-800'
                                    }`}
                                >
                                    Código Raw
                                </button>
                            </div>

                            {/* Main editing area */}
                            <div className="space-y-2">
                                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider">Cuerpo del Mensaje</label>
                                
                                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs flex flex-col">
                                    
                                    {/* Toolbar formatting */}
                                    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-100 bg-slate-50/50 flex-wrap">
                                        <button onClick={() => wrapSelection('b')} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-700 font-bold text-xs" title="Negrita <b>">B</button>
                                        <button onClick={() => wrapSelection('i')} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-700 italic text-xs" title="Cursiva <i>">I</button>
                                        <button onClick={() => wrapSelection('u')} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-700 underline text-xs" title="Subrayado <u>">U</button>
                                        
                                        <div className="w-px h-5 bg-gray-200 mx-1"></div>

                                        {/* Emojis picker dropdown */}
                                        <div className="relative" ref={emojiRef}>
                                            <button onClick={() => { setShowEmojis(!showEmojis); setShowFields(false) }} className="p-1.5 rounded-lg hover:bg-gray-200 text-xs" title="Insertar Emoji">😀</button>
                                            {showEmojis && (
                                                <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-2xl border border-gray-200 p-2 z-[100] w-64">
                                                    {EMOJI_GROUPS.map(grp => (
                                                        <div key={grp.label} className="mb-2">
                                                            <div className="text-[8px] font-bold text-gray-400 uppercase mb-1">{grp.label}</div>
                                                            <div className="flex flex-wrap gap-1">
                                                                {grp.emojis.map(e => (
                                                                    <button
                                                                        key={e}
                                                                        onClick={() => { insertAtCursor(e); setShowEmojis(false) }}
                                                                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-sm"
                                                                    >
                                                                        {e}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Variables / Fields picker dropdown */}
                                        <div className="relative" ref={fieldsRef}>
                                            <button onClick={() => { setShowFields(!showFields); setShowEmojis(false) }} className="px-2.5 py-1 rounded-lg hover:bg-gray-200 text-xs font-semibold text-gray-600 flex items-center gap-1">
                                                <i className="bi bi-braces text-[10px]"></i>
                                                Variables
                                            </button>
                                            {showFields && (
                                                <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 z-[100] w-56 max-h-56 overflow-y-auto">
                                                    {AVAILABLE_FIELDS.map(f => (
                                                        <button
                                                            key={f.key}
                                                            onClick={() => { insertAtCursor(`{{${f.key}}}`); setShowFields(false) }}
                                                            className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-xs text-gray-700 flex flex-col"
                                                        >
                                                            <span className="font-semibold text-gray-800">{f.label}</span>
                                                            <span className="text-[9px] text-gray-400">ej: {f.example}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Conditions builder dropdown */}
                                        <div className="relative" ref={condRef}>
                                            <button onClick={() => setShowCondBuilder(!showCondBuilder)} className="px-2 py-1 rounded-lg hover:bg-gray-200 text-xs font-semibold text-gray-600 flex items-center gap-1">
                                                <i className="bi bi-question-diamond text-[10px]"></i>
                                                Condición
                                            </button>
                                            {showCondBuilder && (
                                                <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 z-[100] w-80 space-y-3">
                                                    <h5 className="text-xs font-bold text-gray-800">Agregar Bloque Condicional</h5>
                                                    <div className="space-y-2">
                                                        <div className="grid grid-cols-2 gap-1.5">
                                                            <div>
                                                                <label className="block text-[8px] font-bold text-gray-400 uppercase">Campo</label>
                                                                <select
                                                                    value={condField}
                                                                    onChange={(e) => setCondField(e.target.value)}
                                                                    className="w-full text-xs p-1 bg-slate-50 border border-gray-200 rounded mt-0.5"
                                                                >
                                                                    {AVAILABLE_FIELDS.map(f => (
                                                                        <option key={f.key} value={f.key}>{f.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <label className="block text-[8px] font-bold text-gray-400 uppercase">Operador</label>
                                                                <select
                                                                    value={condOperator}
                                                                    onChange={(e) => setCondOperator(e.target.value)}
                                                                    className="w-full text-xs p-1 bg-slate-50 border border-gray-200 rounded mt-0.5"
                                                                >
                                                                    <option value="==">Es igual a</option>
                                                                    <option value="!=">No es igual a</option>
                                                                    <option value="contains">Contiene texto</option>
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <label className="block text-[8px] font-bold text-gray-400 uppercase">Valor de Comparación</label>
                                                            <input
                                                                type="text"
                                                                value={condValue}
                                                                onChange={(e) => setCondValue(e.target.value)}
                                                                placeholder="ej. cash"
                                                                className="w-full text-xs p-1 border border-gray-200 rounded mt-0.5"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[8px] font-bold text-gray-400 uppercase">Texto si CUMPLE la condición</label>
                                                            <textarea
                                                                rows={2}
                                                                value={condTrueText}
                                                                onChange={(e) => setCondTrueText(e.target.value)}
                                                                className="w-full text-xs p-1 border border-gray-200 rounded mt-0.5 font-mono"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[8px] font-bold text-gray-400 uppercase">Texto si NO cumple (Opcional - ELSE)</label>
                                                            <textarea
                                                                rows={2}
                                                                value={condFalseText}
                                                                onChange={(e) => setCondFalseText(e.target.value)}
                                                                className="w-full text-xs p-1 border border-gray-200 rounded mt-0.5 font-mono"
                                                            />
                                                        </div>
                                                        <button
                                                            onClick={insertConditionalBlock}
                                                            className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold shadow"
                                                        >
                                                            Insertar Condición
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* WA link creator dropdown */}
                                        <div className="relative" ref={linkRef}>
                                            <button onClick={() => setShowLinkBuilder(!showLinkBuilder)} className="px-2 py-1 rounded-lg hover:bg-gray-200 text-xs font-semibold text-gray-600 flex items-center gap-1">
                                                <i className="bi bi-link-45deg text-[10px]"></i>
                                                Enlace
                                            </button>
                                            {showLinkBuilder && (
                                                <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 z-[100] w-72 space-y-3">
                                                    <h5 className="text-xs font-bold text-gray-800">Insertar Enlace HTML</h5>
                                                    <div className="space-y-2">
                                                        <div>
                                                            <label className="block text-[8px] font-bold text-gray-400 uppercase">Texto del Link</label>
                                                            <input
                                                                type="text"
                                                                value={linkText}
                                                                onChange={(e) => setLinkText(e.target.value)}
                                                                placeholder="ej: Contactar Negocio"
                                                                className="w-full text-xs p-1 border border-gray-200 rounded mt-0.5"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[8px] font-bold text-gray-400 uppercase">URL del Link (o Variable)</label>
                                                            <input
                                                                type="text"
                                                                value={linkUrl}
                                                                onChange={(e) => setLinkUrl(e.target.value)}
                                                                placeholder="ej: {{whatsappLink}} o https://wa.me/..."
                                                                className="w-full text-xs p-1 border border-gray-200 rounded mt-0.5"
                                                            />
                                                        </div>
                                                        <button
                                                            onClick={insertWAUrl}
                                                            className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold shadow"
                                                        >
                                                            Insertar Enlace
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                    </div>

                                    {/* Visual Editor container */}
                                    {drawerTab === 'visual' ? (
                                        <div
                                            ref={visualEditorRef}
                                            contentEditable
                                            onInput={(e) => {
                                                const raw = extractVisualTemplate(e.currentTarget)
                                                lastEmittedRef.current = raw
                                                setDrawerText(raw)
                                            }}
                                            onBlur={() => {
                                                const sel = window.getSelection()
                                                if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange()
                                            }}
                                            className="p-4 min-h-[180px] text-sm focus:outline-none overflow-y-auto leading-relaxed bg-white"
                                        />
                                    ) : (
                                        /* Code Editor Raw textarea */
                                        <textarea
                                            ref={textareaRef}
                                            value={drawerText}
                                            onChange={(e) => setDrawerText(e.target.value)}
                                            className="p-4 min-h-[180px] text-xs font-mono focus:outline-none border-0 resize-none bg-slate-900 text-slate-100"
                                            placeholder="Escribe tu plantilla aquí..."
                                        />
                                    )}
                                </div>
                            </div>

                            {/* Telegram Buttons Inline Keyboard Builder */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                                        Botones de Acción (Teclado Inline)
                                    </label>
                                    <button
                                        onClick={addButtonRow}
                                        className="py-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-gray-700 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                                    >
                                        ＋ Fila de Botones
                                    </button>
                                </div>

                                <div className="space-y-3">
                                    {drawerButtons.map((row, rIdx) => (
                                        <div key={rIdx} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5 relative">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-bold text-gray-400">Fila #{rIdx + 1}</span>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => addButtonToRow(rIdx)}
                                                        className="py-0.5 px-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded text-[9px] font-bold transition-colors cursor-pointer"
                                                    >
                                                        ＋ Botón
                                                    </button>
                                                    <button
                                                        onClick={() => removeButtonRow(rIdx)}
                                                        className="w-5 h-5 flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors cursor-pointer"
                                                        title="Eliminar Fila"
                                                    >
                                                        <i className="bi bi-trash text-[9px]"></i>
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 gap-2.5">
                                                {row.map((btn, bIdx) => (
                                                    <div key={bIdx} className="flex gap-2 items-center bg-white p-2.5 rounded-lg border border-slate-150 shadow-2xs">
                                                        <input
                                                            type="text"
                                                            value={btn.text}
                                                            onChange={(e) => updateButton(rIdx, bIdx, { text: e.target.value })}
                                                            placeholder="Texto en botón"
                                                            className="w-1/3 text-xs p-1 border border-gray-200 rounded focus:border-blue-500 outline-none"
                                                        />
                                                        <select
                                                            value={btn.type}
                                                            onChange={(e) => updateButton(rIdx, bIdx, { type: e.target.value as 'url' | 'callback' })}
                                                            className="w-1/4 text-xs p-1 border border-gray-200 rounded bg-slate-50 outline-none"
                                                        >
                                                            <option value="url">Abrir URL</option>
                                                            <option value="callback">Callback API</option>
                                                        </select>
                                                        <input
                                                            type="text"
                                                            value={btn.value}
                                                            onChange={(e) => updateButton(rIdx, bIdx, { value: e.target.value })}
                                                            placeholder={btn.type === 'url' ? 'https://...' : 'callback_name|{token}'}
                                                            className="flex-1 text-xs p-1 border border-gray-200 rounded font-mono focus:border-blue-500 outline-none"
                                                        />
                                                        <button
                                                            onClick={() => removeButtonFromRow(rIdx, bIdx)}
                                                            className="w-6 h-6 flex items-center justify-center hover:bg-slate-100 text-gray-400 hover:text-red-500 rounded transition-colors cursor-pointer"
                                                        >
                                                            <i className="bi bi-x text-sm"></i>
                                                        </button>
                                                    </div>
                                                ))}
                                                {row.length === 0 && (
                                                    <div className="text-center py-2 text-[10px] text-gray-400 italic">No hay botones en esta fila</div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {drawerButtons.length === 0 && (
                                        <div className="text-center py-4 border-2 border-dashed border-slate-100 rounded-xl text-xs text-gray-400">
                                            No se han añadido botones. Se enviará solo el mensaje de texto.
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Instant Telegram Preview Visualisation */}
                            <div className="space-y-2">
                                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider">Vista Previa (Estilo Telegram)</label>
                                <div className="bg-slate-100 rounded-2xl p-4 flex justify-center">
                                    <div className="bg-white rounded-xl shadow-sm border border-gray-200/80 max-w-sm w-full overflow-hidden">
                                        {/* Telegram header bar */}
                                        <div className="bg-[#5682a3] text-white px-4 py-2 flex items-center gap-2">
                                            <i className="bi bi-telegram text-base"></i>
                                            <div className="leading-tight">
                                                <div className="text-xs font-bold">Fuddi Bot</div>
                                                <div className="text-[9px] opacity-75">bot de notificaciones</div>
                                            </div>
                                        </div>
                                        
                                        {/* Telegram bubble message */}
                                        <div className="p-3 bg-[#e7ebf0]">
                                            <div className="bg-[#eef2f6] rounded-xl p-3 shadow-2xs border border-gray-200/50 relative">
                                                <div
                                                    className="text-xs text-slate-800 leading-normal"
                                                    dangerouslySetInnerHTML={{ __html: renderPreview() || '<span class="text-gray-400 italic">Mensaje vacío</span>' }}
                                                />
                                            </div>
                                            
                                            {/* Render buttons keyboard */}
                                            {drawerButtons.length > 0 && (
                                                <div className="mt-1.5 space-y-1">
                                                    {drawerButtons.map((row, rIdx) => (
                                                        <div key={rIdx} className="flex gap-1 justify-center">
                                                            {row.filter(b => b.text.trim().length > 0).map((btn, bIdx) => (
                                                                <div
                                                                    key={bIdx}
                                                                    className="flex-1 py-1.5 bg-[#f6f8fa]/95 hover:bg-[#eef2f6] text-[#4f749a] text-[10px] font-bold rounded-lg border border-gray-300/40 text-center select-none shadow-2xs flex items-center justify-center gap-1"
                                                                >
                                                                    {btn.type === 'url' && <i className="bi bi-box-arrow-up-right text-[8px]"></i>}
                                                                    {btn.text}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>

                        {/* Drawer Actions Footer */}
                        <div className="px-6 py-4 border-t border-gray-200 bg-slate-50 flex items-center justify-end gap-3">
                            <button
                                onClick={closeEditorDrawer}
                                className="py-2.5 px-4 bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={saveTemplateChanges}
                                disabled={saving}
                                className="py-2.5 px-5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-100 flex items-center gap-1.5 cursor-pointer"
                            >
                                {saving ? (
                                    <>
                                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                        Guardando...
                                    </>
                                ) : (
                                    <>
                                        <i className="bi bi-cloud-check text-sm"></i>
                                        Guardar en Firestore
                                    </>
                                )}
                            </button>
                        </div>

                    </div>
                </div>
            )}
        </div>
    )
}
