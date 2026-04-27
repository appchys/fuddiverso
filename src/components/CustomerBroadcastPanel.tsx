'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { sendTelegramBroadcast, getTelegramBroadcasts } from '@/lib/database'

// Emojis organizados por categoría (reutilizado del TelegramTemplateEditor)
const EMOJI_GROUPS = [
    { label: 'Comida', emojis: ['🍕', '🍔', '🌮', '🍟', '🥗', '🍜', '🍣', '🥤', '☕', '🍩', '🎂', '🍝'] },
    { label: 'Estado', emojis: ['✅', '❌', '⚠️', '⏰', '⚡', '🔔', '📦', '🎉', '🎊', '💯', '🆕', '🔥'] },
    { label: 'Personas', emojis: ['👤', '👨‍🍳', '🛵', '🚴', '🏪', '👋', '🤝', '💪', '🙏', '👍', '📱', '📞'] },
    { label: 'Dinero', emojis: ['💵', '💰', '🏦', '💳', '🧾', '💲', '📊', '📈', '🪙', '💸'] },
    { label: 'Ubicación', emojis: ['📍', '🗺️', '📸', '🏠', '🏁', '🛒', '🚀', '🔗', '📋', '✍️'] },
]

export default function CustomerBroadcastPanel() {
    const [message, setMessage] = useState('')
    const [buttonText, setButtonText] = useState('')
    const [buttonUrl, setButtonUrl] = useState('')
    const [isScheduled, setIsScheduled] = useState(false)
    const [scheduledDate, setScheduledDate] = useState('')
    const [scheduledTime, setScheduledTime] = useState('')
    const [sending, setSending] = useState(false)
    const [result, setResult] = useState<any>(null)
    const [showEmojiPicker, setShowEmojiPicker] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    
    const [history, setHistory] = useState<any[]>([])
    const [loadingHistory, setLoadingHistory] = useState(true)

    const fetchHistory = async () => {
        setLoadingHistory(true)
        const broadcasts = await getTelegramBroadcasts()
        setHistory(broadcasts)
        setLoadingHistory(false)
    }

    useEffect(() => {
        fetchHistory()
    }, [])

    const insertEmoji = (emoji: string) => {
        if (!textareaRef.current) return

        const textarea = textareaRef.current
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const newMessage = message.slice(0, start) + emoji + message.slice(end)

        setMessage(newMessage)
        setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + emoji.length
            textarea.focus()
        }, 0)

        setShowEmojiPicker(false)
    }

    const insertFormatting = (before: string, after: string = '') => {
        if (!textareaRef.current) return

        const textarea = textareaRef.current
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const selectedText = message.slice(start, end) || 'texto'
        const newMessage = message.slice(0, start) + before + selectedText + after + message.slice(end)

        setMessage(newMessage)
        setTimeout(() => {
            textarea.focus()
        }, 0)
    }

    const handleSendBroadcast = async () => {
        if (!message.trim()) {
            alert('El mensaje no puede estar vacío')
            return
        }

        const trimmedButtonText = buttonText.trim()
        const trimmedButtonUrl = buttonUrl.trim()
        const hasButton = trimmedButtonText.length > 0 || trimmedButtonUrl.length > 0

        if (hasButton) {
            if (!trimmedButtonText || !trimmedButtonUrl) {
                alert('Si configuras un botón, completa el texto y la URL')
                return
            }

            try {
                const parsedUrl = new URL(trimmedButtonUrl)
                if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                    alert('La URL del botón debe comenzar con http:// o https://')
                    return
                }
            } catch {
                alert('La URL del botón no es válida')
                return
            }
        }

        let finalScheduledAt: string | undefined = undefined
        if (isScheduled) {
            if (!scheduledDate || !scheduledTime) {
                alert('Debes seleccionar fecha y hora para programar el mensaje')
                return
            }
            const dateObj = new Date(`${scheduledDate}T${scheduledTime}-05:00`)
            if (dateObj <= new Date()) {
                alert('La fecha y hora programada debe ser en el futuro')
                return
            }
            finalScheduledAt = dateObj.toISOString()
        }

        setSending(true)
        setResult(null)

        try {
            const response = await sendTelegramBroadcast(
                message,
                hasButton
                    ? {
                          text: trimmedButtonText,
                          url: trimmedButtonUrl
                      }
                    : undefined,
                finalScheduledAt
            )

            setResult({
                success: response.success,
                message: response.message || response.error,
                stats: response.stats,
                errors: response.errors || []
            })

            if (response.success) {
                // Limpiar el mensaje después de 2 segundos
                setTimeout(() => {
                    setMessage('')
                    setButtonText('')
                    setButtonUrl('')
                    setIsScheduled(false)
                    setScheduledDate('')
                    setScheduledTime('')
                }, 2000)
                fetchHistory()
            }
        } catch (error) {
            setResult({
                success: false,
                message: error instanceof Error ? error.message : 'Error desconocido',
                stats: null
            })
        } finally {
            setSending(false)
        }
    }

    const clearResult = () => {
        setResult(null)
    }

    const characterCount = message.length
    const maxCharacters = 4096 // Límite de Telegram
    const buttonPreviewEnabled = buttonText.trim().length > 0 && buttonUrl.trim().length > 0

    return (
        <div className="space-y-6">
            <div className="space-y-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
                {/* Header */}
                <div>
                    <h3 className="text-2xl font-bold text-gray-900">Enviar Mensaje a Clientes</h3>
                    <p className="text-sm text-gray-500 mt-1">
                        Envía o programa un mensaje a todos los clientes con Telegram vinculado.
                    </p>
                </div>

                {/* Toolbar de Formatos */}
                <div className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <button
                        type="button"
                        onClick={() => insertFormatting('<b>', '</b>')}
                        className="px-3 py-1.5 text-sm font-semibold bg-white border border-gray-300 rounded hover:bg-gray-100 transition"
                        title="Negrita"
                    >
                        <i className="bi bi-type-bold"></i> Negrita
                    </button>
                    <button
                        type="button"
                        onClick={() => insertFormatting('<i>', '</i>')}
                        className="px-3 py-1.5 text-sm font-semibold bg-white border border-gray-300 rounded hover:bg-gray-100 transition"
                        title="Cursiva"
                    >
                        <i className="bi bi-type-italic"></i> Cursiva
                    </button>
                    <button
                        type="button"
                        onClick={() => insertFormatting('<u>', '</u>')}
                        className="px-3 py-1.5 text-sm font-semibold bg-white border border-gray-300 rounded hover:bg-gray-100 transition"
                        title="Subrayado"
                    >
                        <i className="bi bi-type-underline"></i> Subrayado
                    </button>
                    <div className="border-l border-gray-300"></div>
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                            className="px-3 py-1.5 text-sm font-semibold bg-white border border-gray-300 rounded hover:bg-gray-100 transition"
                        >
                            😊 Emojis
                        </button>

                        {/* Emoji Picker */}
                        {showEmojiPicker && (
                            <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-10 max-w-md">
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {EMOJI_GROUPS.map((group) => (
                                        <div key={group.label}>
                                            <p className="text-xs font-semibold text-gray-600 mb-1">{group.label}</p>
                                            <div className="flex flex-wrap gap-1">
                                                {group.emojis.map((emoji) => (
                                                    <button
                                                        key={emoji}
                                                        type="button"
                                                        onClick={() => insertEmoji(emoji)}
                                                        className="text-lg hover:scale-125 transition"
                                                    >
                                                        {emoji}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Editor de Mensaje */}
                <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-700">
                        Mensaje
                    </label>
                    <textarea
                        ref={textareaRef}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Escribe tu mensaje aquí. Puedes usar HTML: &lt;b&gt;negrita&lt;/b&gt;, &lt;i&gt;cursiva&lt;/i&gt;, &lt;a href=&quot;url&quot;&gt;enlace&lt;/a&gt;"
                        className="w-full h-40 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-sm"
                    />
                    <div className="flex justify-between items-center">
                        <p className="text-xs text-gray-500">
                            Puedes usar etiquetas HTML: &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, &lt;a href="url"&gt;
                        </p>
                        <p className={`text-xs font-semibold ${
                            characterCount > maxCharacters ? 'text-red-600' : 'text-gray-500'
                        }`}>
                            {characterCount} / {maxCharacters}
                        </p>
                    </div>
                </div>

                {/* Preview */}
                {message.trim() && (
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-gray-700">
                            Vista Previa
                        </label>
                        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm space-y-2">
                            <div
                                className="text-gray-800 leading-relaxed whitespace-pre-wrap break-words"
                                dangerouslySetInnerHTML={{
                                    __html: message
                                        .replace(/&/g, '&amp;')
                                        .replace(/</g, '&lt;')
                                        .replace(/>/g, '&gt;')
                                        .replace(/<b>(.*?)<\/b>/gi, '<strong>$1</strong>')
                                        .replace(/<i>(.*?)<\/i>/gi, '<em>$1</em>')
                                        .replace(/<u>(.*?)<\/u>/gi, '<u>$1</u>')
                                        .replace(/<a href="([^"]*)">(.*?)<\/a>/gi, '<a href="$1" class="text-blue-600 underline">$2</a>')
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Botón Inline */}
                <div className="space-y-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <div>
                        <h4 className="text-sm font-semibold text-gray-800">Botón inline opcional</h4>
                        <p className="text-xs text-gray-500 mt-1">
                            Si completas ambos campos, el mensaje de Telegram incluirá un botón que llevará a la URL indicada.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="block text-xs font-semibold text-gray-600">
                                Texto del botón
                            </label>
                            <input
                                type="text"
                                value={buttonText}
                                onChange={(e) => setButtonText(e.target.value)}
                                placeholder="Ver promoción"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="block text-xs font-semibold text-gray-600">
                                URL del botón
                            </label>
                            <input
                                type="url"
                                value={buttonUrl}
                                onChange={(e) => setButtonUrl(e.target.value)}
                                placeholder="https://tusitio.com/promocion"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                            />
                        </div>
                    </div>

                    {buttonPreviewEnabled ? (
                        <div className="pt-2">
                            <p className="text-xs font-semibold text-gray-600 mb-2">Vista previa del botón</p>
                            <div className="inline-flex">
                                <a
                                    href={buttonUrl.trim()}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm"
                                >
                                    {buttonText.trim()}
                                </a>
                            </div>
                        </div>
                    ) : (
                        <p className="text-xs text-gray-500">
                            Puedes dejar estos campos vacíos si el mensaje no necesita botón.
                        </p>
                    )}
                </div>

                {/* Programar envío */}
                <div className="space-y-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="text-sm font-semibold text-gray-800">Programar envío</h4>
                            <p className="text-xs text-gray-500 mt-1">
                                En lugar de enviar el mensaje ahora, prográmalo para una fecha futura.
                            </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={isScheduled} onChange={(e) => setIsScheduled(e.target.checked)} />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>

                    {isScheduled && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-gray-600">Fecha</label>
                                <input
                                    type="date"
                                    value={scheduledDate}
                                    min={new Date().toISOString().split('T')[0]}
                                    onChange={(e) => setScheduledDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-gray-600">Hora</label>
                                <input
                                    type="time"
                                    value={scheduledTime}
                                    onChange={(e) => setScheduledTime(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Botón Enviar */}
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                    <button
                        onClick={handleSendBroadcast}
                        disabled={sending || !message.trim() || characterCount > maxCharacters}
                        className={`flex-1 px-4 py-3 font-semibold rounded-lg transition flex items-center justify-center gap-2 ${
                            sending || !message.trim() || characterCount > maxCharacters
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'
                        }`}
                    >
                        {sending ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Guardando...
                            </>
                        ) : (
                            <>
                                <i className="bi bi-send"></i>
                                {isScheduled ? 'Programar Broadcast' : 'Enviar a Todos Ahora'}
                            </>
                        )}
                    </button>
                </div>

                {/* Resultado */}
                {result && (
                    <div className={`p-4 rounded-lg border-2 space-y-3 ${
                        result.success
                            ? 'bg-green-50 border-green-200'
                            : 'bg-red-50 border-red-200'
                    }`}>
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex gap-3 items-start flex-1">
                                <div className={`text-2xl flex-shrink-0 ${
                                    result.success ? 'text-green-600' : 'text-red-600'
                                }`}>
                                    {result.success ? '✅' : '❌'}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`font-semibold ${
                                        result.success ? 'text-green-900' : 'text-red-900'
                                    }`}>
                                        {result.message}
                                    </p>
                                    {result.stats && result.stats.total > 0 && !isScheduled && (
                                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            <div className="bg-white rounded p-3 border border-gray-200">
                                                <p className="text-xs text-gray-600 font-semibold">Total de Clientes</p>
                                                <p className="text-2xl font-bold text-blue-600">{result.stats.total}</p>
                                            </div>
                                            <div className="bg-white rounded p-3 border border-green-200">
                                                <p className="text-xs text-gray-600 font-semibold">Enviados Correctamente</p>
                                                <p className="text-2xl font-bold text-green-600">{result.stats.successful}</p>
                                            </div>
                                            <div className="bg-white rounded p-3 border border-red-200">
                                                <p className="text-xs text-gray-600 font-semibold">Fallos</p>
                                                <p className="text-2xl font-bold text-red-600">{result.stats.failed}</p>
                                            </div>
                                        </div>
                                    )}
                                    {result.errors && result.errors.length > 0 && (
                                        <div className="mt-3 space-y-2">
                                            <p className="text-xs font-semibold text-gray-600">Errores Detallados:</p>
                                            <div className="max-h-48 overflow-y-auto space-y-1">
                                                {result.errors.slice(0, 5).map((err: any, idx: number) => (
                                                    <p key={idx} className="text-xs text-gray-700 bg-white rounded px-2 py-1 border border-gray-300">
                                                        {err.clientName && <span className="font-semibold">{err.clientName}:</span>} {err.error}
                                                    </p>
                                                ))}
                                                {result.errors.length > 5 && (
                                                    <p className="text-xs text-gray-600 italic">
                                                        ... y {result.errors.length - 5} errores más
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={clearResult}
                                className="text-gray-500 hover:text-gray-700 transition flex-shrink-0"
                                title="Cerrar"
                            >
                                <i className="bi bi-x text-xl"></i>
                            </button>
                        </div>
                    </div>
                )}

                {/* Información de Seguridad */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                    <i className="bi bi-info-circle me-2"></i>
                    Solo los clientes que han vinculado su cuenta de Telegram recibirán este mensaje.
                    Se guarda un registro de todos los broadcasts enviados.
                </div>
            </div>

            {/* Historial de Broadcasts */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900">Historial de Mensajes</h3>
                        <p className="text-sm text-gray-500">Últimos broadcasts enviados o programados</p>
                    </div>
                    <button onClick={fetchHistory} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Actualizar">
                        <i className={`bi bi-arrow-clockwise ${loadingHistory ? 'animate-spin' : ''}`}></i>
                    </button>
                </div>
                
                <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                    {loadingHistory ? (
                        <div className="p-8 text-center text-gray-500">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                            Cargando historial...
                        </div>
                    ) : history.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            No hay broadcasts en el historial
                        </div>
                    ) : (
                        history.map((item) => {
                            const dateObj = item.createdAt?.toDate ? item.createdAt.toDate() : item.createdAt ? new Date(item.createdAt) : new Date()
                            const scheduledObj = item.scheduledAt ? new Date(item.scheduledAt) : null
                            
                            const formatEcuadorTime = (date: Date) => {
                                return date.toLocaleString('es-EC', {
                                    timeZone: 'America/Guayaquil',
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })
                            }
                            
                            return (
                                <div key={item.id} className="p-4 hover:bg-gray-50 transition">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            {item.status === 'pending' ? (
                                                <span className="px-2 py-1 bg-amber-100 text-amber-800 text-xs font-semibold rounded-full flex items-center gap-1">
                                                    <i className="bi bi-clock-history"></i> Programado
                                                </span>
                                            ) : (
                                                <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full flex items-center gap-1">
                                                    <i className="bi bi-check-circle"></i> Completado
                                                </span>
                                            )}
                                            
                                            {scheduledObj ? (
                                                <span className="text-xs text-gray-500 font-medium">
                                                    Para: {formatEcuadorTime(scheduledObj)}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-gray-500 font-medium">
                                                    Enviado: {formatEcuadorTime(dateObj)}
                                                </span>
                                            )}
                                        </div>
                                        
                                        {!item.status || item.status === 'completed' ? (
                                            <div className="flex text-xs gap-3">
                                                <span className="text-gray-600" title="Total destinatarios"><i className="bi bi-people me-1"></i>{item.totalRecipients || 0}</span>
                                                <span className="text-green-600" title="Enviados"><i className="bi bi-check me-1"></i>{item.successful || 0}</span>
                                                {(item.failed > 0) && (
                                                    <span className="text-red-600" title="Fallidos"><i className="bi bi-x me-1"></i>{item.failed}</span>
                                                )}
                                            </div>
                                        ) : null}
                                    </div>
                                    
                                    <div className="bg-gray-100 p-3 rounded text-sm text-gray-700 whitespace-pre-wrap font-mono line-clamp-3">
                                        {item.message}
                                    </div>
                                    
                                    {item.button && (
                                        <div className="mt-2 text-xs">
                                            <span className="font-semibold text-gray-600">Botón: </span>
                                            <a href={item.button.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                                {item.button.text}
                                            </a>
                                        </div>
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>
            </div>
        </div>
    )
}
