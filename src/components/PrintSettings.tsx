'use client'

import React, { useState, useEffect } from 'react'
import { Business } from '@/types'

interface PrintSettingsProps {
    business: Business
    onBusinessFieldChange: (field: keyof Business, value: any) => void
    printMode?: 'standard' | 'bluetooth'
    onTogglePrintMode?: () => void
}

export default function PrintSettings({
    business,
    onBusinessFieldChange,
    printMode = 'standard',
    onTogglePrintMode
}: PrintSettingsProps) {

    // Inicializar estado local con los valores del negocio o defaults
    const [localSettings, setLocalSettings] = useState({
        autoPrintOnConfirm: true,
        groupItemsByProduct: true,
        ...business.notificationSettings
    })

    // Sincronizar estado local si cambian las props
    useEffect(() => {
        if (business.notificationSettings) {
            setLocalSettings(prev => ({
                ...prev,
                ...business.notificationSettings
            }))
        }
    }, [business.notificationSettings])

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

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 max-w-4xl mx-auto space-y-6">
            {/* Header de la sección Configuración */}
            <div className="flex items-center gap-3 border-b border-gray-100 pb-5">
                <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center text-xl font-bold">
                    <i className="bi bi-printer"></i>
                </div>
                <div>
                    <h3 className="text-xl font-black text-gray-900 tracking-tight">Configuración</h3>
                    <p className="text-xs font-medium text-gray-500">
                        Administra el formato de impresión, auto-impresión de comandas y preferencias de tickets.
                    </p>
                </div>
            </div>

            {/* Opciones de Impresión */}
            <div className="space-y-6">
                <div className="bg-gray-50/80 rounded-2xl border border-gray-100 p-5 space-y-6">
                    
                    {/* Auto-impresión */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h5 className="font-bold text-gray-900 text-sm">Auto-impresión de comandas</h5>
                            <p className="text-xs text-gray-500 mt-0.5">
                                Imprimir el ticket automáticamente al presionar el botón "Confirmar pedido".
                            </p>
                        </div>
                        <div
                            className={`relative inline-block w-12 h-6 rounded-full cursor-pointer transition-colors duration-200 ${localSettings.autoPrintOnConfirm ? 'bg-rose-500' : 'bg-gray-200'}`}
                            onClick={() => handleToggle('autoPrintOnConfirm' as any)}
                        >
                            <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-sm ${localSettings.autoPrintOnConfirm ? 'translate-x-6' : ''}`}></div>
                        </div>
                    </div>

                    {/* Modo de Impresión */}
                    <div className="pt-4 border-t border-gray-200/60">
                        <div className="mb-3">
                            <h5 className="font-bold text-gray-900 text-sm">Modo de Impresión</h5>
                            <p className="text-xs text-gray-500 mt-0.5">
                                Selecciona cómo deseas emitir los tickets de tus pedidos.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                                onClick={() => printMode === 'bluetooth' && onTogglePrintMode?.()}
                                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${printMode === 'standard' ? 'bg-rose-50/80 border-rose-500 text-rose-700 shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                            >
                                <i className="bi bi-file-earmark-pdf text-2xl"></i>
                                <span className="text-xs font-bold uppercase tracking-wider">Navegador (PDF estándar)</span>
                            </button>
                            <button
                                onClick={() => printMode === 'standard' && onTogglePrintMode?.()}
                                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${printMode === 'bluetooth' ? 'bg-blue-50/80 border-blue-500 text-blue-700 shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                            >
                                <i className="bi bi-bluetooth text-2xl"></i>
                                <span className="text-xs font-bold uppercase tracking-wider">Bluetooth (Impresora Térmica)</span>
                            </button>
                        </div>

                        {printMode === 'bluetooth' && (
                            <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-800 flex items-start gap-2">
                                <i className="bi bi-info-circle-fill text-blue-600 mt-0.5"></i>
                                <span>Optimizado para impresoras térmicas MPT-II y similares. Al confirmar un pedido se enviará directo a la impresora activa.</span>
                            </div>
                        )}
                    </div>

                    {/* Agrupar productos */}
                    <div className="pt-4 border-t border-gray-200/60 flex items-center justify-between">
                        <div>
                            <h5 className="font-bold text-gray-900 text-sm">Agrupar productos en ticket</h5>
                            <p className="text-xs text-gray-500 mt-0.5">
                                Agrupar variantes e ítems idénticos bajo el mismo encabezado de producto.
                            </p>
                        </div>
                        <div
                            className={`relative inline-block w-12 h-6 rounded-full cursor-pointer transition-colors duration-200 ${localSettings.groupItemsByProduct ? 'bg-rose-500' : 'bg-gray-200'}`}
                            onClick={() => handleToggle('groupItemsByProduct' as any)}
                        >
                            <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-sm ${localSettings.groupItemsByProduct ? 'translate-x-6' : ''}`}></div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="text-xs text-gray-400 text-center font-medium pt-2">
                <p>Nota: Todos los cambios guardados se aplican de forma inmediata.</p>
            </div>
        </div>
    )
}
