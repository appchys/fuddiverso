'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function WhatsAppRedirectContent() {
    const searchParams = useSearchParams()
    const [targetUrl, setTargetUrl] = useState<string>('')
    const [statusMessage, setStatusMessage] = useState('Abriendo WhatsApp...')

    useEffect(() => {
        let finalUrl = ''

        const rawUrl = searchParams?.get('url')
        if (rawUrl) {
            finalUrl = rawUrl
        } else {
            const phone = searchParams?.get('phone') || ''
            const text = searchParams?.get('text') || ''
            const cleanPhone = phone.replace(/\D/g, '')
            finalUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`
        }

        setTargetUrl(finalUrl)

        if (!finalUrl) {
            setStatusMessage('No se proporcionó un enlace válido de WhatsApp.')
            return
        }

        // 1. Redirigir a WhatsApp
        try {
            window.location.href = finalUrl
        } catch (e) {
            console.error('Error al redirigir a WhatsApp:', e)
        }

        // 2. Al perder foco (cuando la app de WhatsApp se abre en el sistema operativo), cerrar más rápido
        const handleBlur = () => {
            setTimeout(() => {
                try {
                    window.close()
                } catch {
                    // ignore
                }
            }, 400)
        }

        window.addEventListener('blur', handleBlur)

        // 3. Temporizador de respaldo para auto-cerrar la pestaña
        const closeTimer = setTimeout(() => {
            try {
                window.close()
            } catch {
                setStatusMessage('Listo. Puedes cerrar esta pestaña.')
            }
        }, 1800)

        return () => {
            clearTimeout(closeTimer)
            window.removeEventListener('blur', handleBlur)
        }
    }, [searchParams])

    const handleManualClose = () => {
        try {
            window.close()
        } catch {
            window.history.back()
        }
    }

    return (
        <main className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-gray-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-emerald-100 p-8 text-center space-y-5">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/25 animate-pulse">
                    <i className="bi bi-whatsapp text-3xl"></i>
                </div>

                <div className="space-y-1">
                    <h1 className="text-xl font-black text-gray-900 tracking-tight leading-tight">
                        {statusMessage}
                    </h1>
                    <p className="text-xs font-medium text-gray-500 leading-relaxed">
                        Esta pestaña se cerrará automáticamente en un momento.
                    </p>
                </div>

                <div className="pt-2 flex flex-col gap-2">
                    <button
                        type="button"
                        onClick={handleManualClose}
                        className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition-all active:scale-95"
                    >
                        Cerrar pestaña ahora
                    </button>

                    {targetUrl && (
                        <a
                            href={targetUrl}
                            className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 hover:underline pt-1 block"
                        >
                            ¿No se abrió? Clic aquí para reintentar
                        </a>
                    )}
                </div>
            </div>
        </main>
    )
}

export default function WhatsAppRedirectPage() {
    return (
        <Suspense
            fallback={
                <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                    <div className="text-center text-xs font-bold text-gray-400">
                        Cargando...
                    </div>
                </main>
            }
        >
            <WhatsAppRedirectContent />
        </Suspense>
    )
}
