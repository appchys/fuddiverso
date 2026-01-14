import React from 'react'
import { Business } from '@/types'

interface NotificationSettingsProps {
    business: Business
    onBusinessFieldChange: (field: keyof Business, value: any) => void
}

export default function NotificationSettings({
    business,
    onBusinessFieldChange
}: NotificationSettingsProps) {

    const settings = business.notificationSettings || {
        emailOrderClient: true,
        emailOrderManual: true
    }

    const handleToggle = (key: keyof typeof settings) => {
        const newSettings = {
            ...settings,
            [key]: !settings[key]
        }
        onBusinessFieldChange('notificationSettings', newSettings)
    }

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="max-w-2xl mx-auto">
                <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-900">Configuración de Notificaciones</h3>
                    <p className="text-sm text-gray-500">Controla qué correos electrónicos recibe tu tienda.</p>
                </div>

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
                            className={`relative inline-block w-12 h-6 rounded-full cursor-pointer transition-colors duration-200 ${settings.emailOrderClient ? 'bg-red-500' : 'bg-gray-200'}`}
                            onClick={() => handleToggle('emailOrderClient')}
                        >
                            <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-sm ${settings.emailOrderClient ? 'translate-x-6' : ''}`}></div>
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
                            className={`relative inline-block w-12 h-6 rounded-full cursor-pointer transition-colors duration-200 ${settings.emailOrderManual ? 'bg-red-500' : 'bg-gray-200'}`}
                            onClick={() => handleToggle('emailOrderManual')}
                        >
                            <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-sm ${settings.emailOrderManual ? 'translate-x-6' : ''}`}></div>
                        </div>
                    </div>

                </div>

                <div className="mt-6 text-xs text-gray-400 text-center">
                    <p>Nota: Los cambios se guardan automáticamente al modificar las opciones, pero recuerda "Guardar Cambios" en el perfil si estás en modo edición general.</p>
                </div>

            </div>
        </div>
    )
}
