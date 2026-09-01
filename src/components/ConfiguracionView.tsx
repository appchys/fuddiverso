'use client'

import React, { useState } from 'react'
import { Business } from '@/types'
import NotificationSettings from './NotificationSettings'
import PrintSettings from './PrintSettings'

interface ConfiguracionViewProps {
    business: Business
    onBusinessFieldChange: (field: keyof Business, value: any) => void
    onDirectUpdate?: (field: keyof Business, value: any) => Promise<void>
    printMode?: 'standard' | 'bluetooth'
    onTogglePrintMode?: () => void
    initialConfigSubTab?: 'notifications' | 'print'
}

export default function ConfiguracionView({
    business,
    onBusinessFieldChange,
    onDirectUpdate,
    printMode = 'standard',
    onTogglePrintMode,
    initialConfigSubTab = 'notifications'
}: ConfiguracionViewProps) {
    const [configSubTab, setConfigSubTab] = useState<'notifications' | 'print'>(initialConfigSubTab)

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden max-w-4xl mx-auto">
            {/* Header de la sección Configuración */}
            <div className="p-6 border-b border-gray-100 bg-gradient-to-b from-gray-50/50 to-white">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center text-xl font-bold">
                        <i className="bi bi-gear-fill"></i>
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-gray-900 tracking-tight">Configuración</h3>
                        <p className="text-xs font-medium text-gray-500">
                            Administra las notificaciones del negocio y las preferencias de impresión de comandas.
                        </p>
                    </div>
                </div>

                {/* Sub-pestañas: Notificaciones | Configuración de Impresión */}
                <div className="flex bg-gray-100/80 p-1 rounded-xl gap-1">
                    <button
                        onClick={() => setConfigSubTab('notifications')}
                        className={`flex-1 py-2.5 px-4 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
                            configSubTab === 'notifications'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <i className="bi bi-bell-fill text-rose-500"></i>
                        Notificaciones
                    </button>
                    <button
                        onClick={() => setConfigSubTab('print')}
                        className={`flex-1 py-2.5 px-4 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
                            configSubTab === 'print'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <i className="bi bi-printer-fill text-rose-500"></i>
                        Impresión
                    </button>
                </div>
            </div>

            {/* Contenido según la sub-pestaña elegida */}
            <div className="p-6">
                {configSubTab === 'notifications' && (
                    <NotificationSettings
                        business={business}
                        onBusinessFieldChange={onBusinessFieldChange}
                        printMode={printMode}
                        onTogglePrintMode={onTogglePrintMode}
                    />
                )}

                {configSubTab === 'print' && (
                    <PrintSettings
                        business={business}
                        onBusinessFieldChange={onBusinessFieldChange}
                        printMode={printMode}
                        onTogglePrintMode={onTogglePrintMode}
                    />
                )}
            </div>
        </div>
    )
}

