'use client'

import { useState, useRef, useCallback } from 'react'
import { sendTelegramBroadcast } from '@/lib/database'

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
    const [sending, setSending] = useState(false)
    const [result, setResult] = useState<any>(null)
    const [showEmojiPicker, setShowEmojiPicker] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

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

        setSending(true)
        setResult(null)

        try {
            const response = await sendTelegramBroadcast(message)

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
                }, 2000)
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

    return (
        <div className="space-y-6 bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            {/* Header */}
            <div>
                <h3 className="text-2xl font-bold text-gray-900">Enviar Mensaje a Clientes</h3>
                <p className="text-sm text-gray-500 mt-1">
                    Envía un mensaje personalizado a todos los clientes que tienen Telegram vinculado
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
                            Enviando...
                        </>
                    ) : (
                        <>
                            <i className="bi bi-send"></i>
                            Enviar a Todos
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
                                {result.stats && (
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
    )
}
