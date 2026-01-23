'use client'

import { QueueStatus } from '@/lib/offline-queue'

interface QueueStatusIndicatorProps {
    status: QueueStatus
    onRetry?: () => void
    className?: string
}

export default function QueueStatusIndicator({
    status,
    onRetry,
    className = ''
}: QueueStatusIndicatorProps) {
    const { pending, syncing, failed } = status

    // No mostrar nada si no hay órdenes pendientes
    if (pending === 0 && syncing === 0 && failed === 0) {
        return null
    }

    return (
        <div className={`flex items-center gap-2 ${className}`}>
            {/* Badge de órdenes pendientes */}
            {pending > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                    <i className="bi bi-clock-history"></i>
                    <span>{pending} pendiente{pending !== 1 ? 's' : ''}</span>
                </div>
            )}

            {/* Indicador de sincronización */}
            {syncing > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-50 text-green-700 rounded-full text-xs font-medium">
                    <i className="bi bi-arrow-repeat animate-spin"></i>
                    <span>Sincronizando...</span>
                </div>
            )}

            {/* Indicador de errores */}
            {failed > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-700 rounded-full text-xs font-medium">
                    <i className="bi bi-exclamation-triangle"></i>
                    <span>{failed} fallido{failed !== 1 ? 's' : ''}</span>
                    {onRetry && (
                        <button
                            onClick={onRetry}
                            className="ml-1 text-red-700 hover:text-red-900 underline"
                            title="Reintentar"
                        >
                            Reintentar
                        </button>
                    )}
                </div>
            )}

            {/* Indicador offline */}
            {!navigator.onLine && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
                    <i className="bi bi-wifi-off"></i>
                    <span>Sin conexión</span>
                </div>
            )}
        </div>
    )
}
