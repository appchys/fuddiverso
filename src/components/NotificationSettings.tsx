import React, { useState, useEffect } from 'react'
import { Business } from '@/types'

interface NotificationSettingsProps {
    business: Business
    onBusinessFieldChange: (field: keyof Business, value: any) => void
}

export default function NotificationSettings({
    business,
    onBusinessFieldChange
}: NotificationSettingsProps) {

    // Inicializar estado local con los valores del negocio o defaults
    const [localSettings, setLocalSettings] = useState(business.notificationSettings || {
        emailOrderClient: true,
        emailOrderManual: false,
        emailCheckoutProgress: false
    })

    const [telegramChatId, setTelegramChatId] = useState(business.telegramChatId || '')
    const [showTelegramInstructions, setShowTelegramInstructions] = useState(false)

    // Sincronizar estado local si cambian las props (ej: al cargar o si otra persona actualiza)
    useEffect(() => {
        if (business.notificationSettings) {
            setLocalSettings(business.notificationSettings)
        }
        if (business.telegramChatId) {
            setTelegramChatId(business.telegramChatId)
        }
    }, [business.notificationSettings, business.telegramChatId])

    const handleToggle = (key: keyof typeof localSettings) => {
        const newSettings = {
            ...localSettings,
            [key]: !localSettings[key]
        }

        // Actualización optimista inmediata
        setLocalSettings(newSettings)

        // Persistir cambios
        onBusinessFieldChange('notificationSettings', newSettings)
    }

    const handleUnlinkTelegram = () => {
        if (confirm('¿Estás seguro de que quieres desvincular tu cuenta de Telegram?')) {
            setTelegramChatId('')
            onBusinessFieldChange('telegramChatId', '')
        }
    }

    const TELEGRAM_BOT_USERNAME = 'pedidosfuddibot'

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="max-w-2xl mx-auto">
                <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-900">Configuración de Notificaciones</h3>
                    <p className="text-sm text-gray-500">Controla cómo recibes las notificaciones de tu tienda.</p>
                </div>

                {/* Sección de Telegram */}
                <div className="mb-8">
                    <h4 className="text-md font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <i className="bi bi-telegram text-blue-500 text-xl"></i>
                        Notificaciones por Telegram
                    </h4>

                    {telegramChatId ? (
                        // Telegram vinculado
                        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                                        <i className="bi bi-check-circle-fill text-green-600 text-xl"></i>
                                    </div>
                                    <div>
                                        <h5 className="font-medium text-green-900">Telegram Vinculado</h5>
                                        <p className="text-sm text-green-700 mt-1">
                                            Recibirás notificaciones de nuevos pedidos directamente en Telegram.
                                        </p>
                                        <p className="text-xs text-green-600 mt-2 font-mono">
                                            Chat ID: {telegramChatId}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleUnlinkTelegram}
                                    className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                    Desvincular
                                </button>
                            </div>
                        </div>
                    ) : (
                        // Telegram no vinculado
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                            <div className="flex items-start gap-3 mb-4">
                                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                                    <i className="bi bi-telegram text-blue-600 text-xl"></i>
                                </div>
                                <div className="flex-1">
                                    <h5 className="font-medium text-blue-900">Vincular con Telegram</h5>
                                    <p className="text-sm text-blue-700 mt-1">
                                        Recibe notificaciones instantáneas de nuevos pedidos en tu Telegram.
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={() => setShowTelegramInstructions(!showTelegramInstructions)}
                                className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                <i className="bi bi-link-45deg text-xl"></i>
                                Vincular Telegram
                            </button>

                            {showTelegramInstructions && (
                                <div className="mt-4 p-4 bg-white rounded-lg border border-blue-200">
                                    <h6 className="font-semibold text-gray-900 mb-3">Instrucciones:</h6>
                                    <ol className="space-y-2 text-sm text-gray-700">
                                        <li className="flex items-start gap-2">
                                            <span className="flex-shrink-0 w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">1</span>
                                            <span>Abre Telegram y busca el bot <strong className="font-mono">@{TELEGRAM_BOT_USERNAME}</strong></span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="flex-shrink-0 w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">2</span>
                                            <span>Envía el comando <code className="px-2 py-0.5 bg-gray-100 rounded font-mono text-xs">/start {business.id}</code></span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="flex-shrink-0 w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">3</span>
                                            <span>El bot confirmará la vinculación y esta página se actualizará automáticamente</span>
                                        </li>
                                    </ol>

                                    <a
                                        href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${business.id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-4 w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                                    >
                                        <i className="bi bi-telegram text-lg"></i>
                                        Abrir en Telegram
                                    </a>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Notificaciones por Correo */}
                <div>
                    <h4 className="text-md font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <i className="bi bi-envelope text-gray-600 text-xl"></i>
                        Notificaciones por Correo
                    </h4>

                    <div className="space-y-4">

                        {/* Notificaciones de Pedidos de Clientes */}
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                            <div>
                                <h4 className="font-medium text-gray-900">Pedidos de Clientes</h4>
                                <p className="text-sm text-gray-500">
                                    Recibir correo cuando un cliente realiza un pedido desde la web.
                                </p>
                            </div>
                            <div
                                className={`relative inline-block w-12 h-6 rounded-full cursor-pointer transition-colors duration-200 ${localSettings.emailOrderClient ? 'bg-red-500' : 'bg-gray-200'}`}
                                onClick={() => handleToggle('emailOrderClient')}
                            >
                                <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-sm ${localSettings.emailOrderClient ? 'translate-x-6' : ''}`}></div>
                            </div>
                        </div>

                        {/* Notificaciones de Pedidos Manuales */}
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                            <div>
                                <h4 className="font-medium text-gray-900">Pedidos Manuales</h4>
                                <p className="text-sm text-gray-500">
                                    Recibir correo cuando la tienda registra un pedido manualmente.
                                </p>
                            </div>
                            <div
                                className={`relative inline-block w-12 h-6 rounded-full cursor-pointer transition-colors duration-200 ${localSettings.emailOrderManual ? 'bg-red-500' : 'bg-gray-200'}`}
                                onClick={() => handleToggle('emailOrderManual')}
                            >
                                <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-sm ${localSettings.emailOrderManual ? 'translate-x-6' : ''}`}></div>
                            </div>
                        </div>

                        {/* Notificaciones de Checkout en Progreso */}
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                            <div>
                                <h4 className="font-medium text-gray-900">Checkout en Progreso</h4>
                                <p className="text-sm text-gray-500">
                                    Recibir correo cuando un cliente inicia el proceso de checkout.
                                </p>
                            </div>
                            <div
                                className={`relative inline-block w-12 h-6 rounded-full cursor-pointer transition-colors duration-200 ${localSettings.emailCheckoutProgress ? 'bg-red-500' : 'bg-gray-200'}`}
                                onClick={() => handleToggle('emailCheckoutProgress')}
                            >
                                <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-sm ${localSettings.emailCheckoutProgress ? 'translate-x-6' : ''}`}></div>
                            </div>
                        </div>

                    </div>
                </div>

                <div className="mt-6 text-xs text-gray-400 text-center">
                    <p>Nota: Los cambios se guardan automáticamente.</p>
                </div>

            </div>
        </div>
    )
}
