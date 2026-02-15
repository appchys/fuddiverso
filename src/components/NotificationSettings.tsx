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
    const [localSettings, setLocalSettings] = useState({
        emailOrderClient: true,
        emailOrderManual: false,
        emailCheckoutProgress: false,
        telegramOrderManual: false,
        ...business.notificationSettings
    })

    const [telegramChatIds, setTelegramChatIds] = useState<string[]>(business.telegramChatIds || [])
    const [linkCopied, setLinkCopied] = useState(false)

    // Sincronizar estado local si cambian las props
    useEffect(() => {
        if (business.notificationSettings) {
            setLocalSettings(prev => ({
                ...prev,
                ...business.notificationSettings
            }))
        }

        // Unificar IDs nuevos y antiguos para la visualización
        let ids = business.telegramChatIds || []
        if (business.telegramChatId && !ids.includes(business.telegramChatId)) {
            ids = [...ids, business.telegramChatId]
        }
        setTelegramChatIds(ids)
    }, [business.notificationSettings, business.telegramChatIds, business.telegramChatId])

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
        if (confirm('¿Estás seguro de que quieres desvincular TODAS las cuentas de Telegram de esta tienda?')) {
            setTelegramChatIds([])
            // Limpiamos ambos campos para resetear completamente
            onBusinessFieldChange('telegramChatIds', [])
            onBusinessFieldChange('telegramChatId', '')
        }
    }

    const handleCopyLink = async () => {
        const link = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${business.id}`
        try {
            await navigator.clipboard.writeText(link)
            setLinkCopied(true)
            setTimeout(() => setLinkCopied(false), 2000)
        } catch (err) {
            console.error('Error copiando link:', err)
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

                    {telegramChatIds.length > 0 ? (
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
                                            {telegramChatIds.length} {telegramChatIds.length === 1 ? 'cuenta recibe' : 'cuentas reciben'} notificaciones de nuevos pedidos.
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <a
                                                href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${business.id}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="px-3 py-1 text-xs font-medium bg-white text-blue-600 border border-blue-200 rounded-full hover:bg-blue-50 transition-colors flex items-center gap-1"
                                            >
                                                <i className="bi bi-plus-lg"></i>
                                                Vincular otra
                                            </a>
                                            <button
                                                onClick={handleCopyLink}
                                                className="px-3 py-1 text-xs font-medium bg-white text-gray-600 border border-gray-200 rounded-full hover:bg-gray-50 transition-colors flex items-center gap-1"
                                            >
                                                <i className={`bi ${linkCopied ? 'bi-check' : 'bi-clipboard'}`}></i>
                                                {linkCopied ? 'Copiado' : 'Copiar link'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={handleUnlinkTelegram}
                                    className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                    Limpiar todos
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

                            <div className="grid grid-cols-2 gap-3">
                                <a
                                    href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${business.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    <i className="bi bi-telegram text-xl"></i>
                                    Vincular
                                </a>

                                <button
                                    onClick={handleCopyLink}
                                    className="px-4 py-2.5 bg-white hover:bg-gray-50 text-blue-600 font-medium rounded-lg transition-colors flex items-center justify-center gap-2 border-2 border-blue-600"
                                >
                                    <i className={`bi ${linkCopied ? 'bi-check-lg' : 'bi-clipboard'} text-lg`}></i>
                                    {linkCopied ? 'Copiado' : 'Copiar Link'}
                                </button>
                            </div>

                            <p className="text-xs text-blue-700 mt-3 flex items-start gap-2">
                                <i className="bi bi-info-circle flex-shrink-0 mt-0.5"></i>
                                <span>Después de hacer clic en "Vincular", presiona el botón <strong>"Start"</strong> o <strong>"Iniciar"</strong> en Telegram para completar la vinculación.</span>
                            </p>
                        </div>
                    )}
                </div>

                {/* Preferencias de Notificación */}
                <div>
                    <h4 className="text-md font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <i className="bi bi-bell text-gray-600 text-xl"></i>
                        Preferencias de Notificación
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

                        {/* Telegram Pedidos Manuales */}
                        <div className="flex items-center justify-between p-4 bg-blue-50/50 rounded-lg border border-blue-100">
                            <div>
                                <h4 className="font-medium text-blue-900 flex items-center gap-2">
                                    <i className="bi bi-telegram"></i>
                                    Pedidos Manuales (Telegram)
                                </h4>
                                <p className="text-sm text-blue-700">
                                    Recibir notificación por Telegram cuando la tienda registra un pedido manualmente.
                                </p>
                            </div>
                            <div
                                className={`relative inline-block w-12 h-6 rounded-full cursor-pointer transition-colors duration-200 ${localSettings.telegramOrderManual ? 'bg-blue-500' : 'bg-gray-200'}`}
                                onClick={() => handleToggle('telegramOrderManual' as any)}
                            >
                                <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-sm ${localSettings.telegramOrderManual ? 'translate-x-6' : ''}`}></div>
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
