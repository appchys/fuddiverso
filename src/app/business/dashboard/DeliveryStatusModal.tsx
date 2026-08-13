'use client'

import React, { useState } from 'react'
import { Order, Delivery } from '@/types'

export function DeliveryStatusModal({
    isOpen,
    onClose,
    order,
    deliveryAgent,
    availableDeliveries,
    canChangeDelivery,
    onDeliveryAssign,
    onWhatsApp,
    deliveryServiceType,
    defaultDeliveryId,
    onAutoAssignFuddi
}: {
    isOpen: boolean,
    onClose: () => void,
    order: Order | null,
    deliveryAgent?: Delivery,
    availableDeliveries: Delivery[],
    canChangeDelivery: boolean,
    onDeliveryAssign: (id: string, deliveryId: string) => void | Promise<void>,
    onWhatsApp: () => void,
    deliveryServiceType?: 'self' | 'fuddi',
    defaultDeliveryId?: string,
    onAutoAssignFuddi?: (order: Order) => void | Promise<void>
}) {
    const [isSearchingFuddi, setIsSearchingFuddi] = useState(false)
    const [showSelfSelect, setShowSelfSelect] = useState(false)

    if (!isOpen || !order) return null

    const status = order.delivery?.acceptanceStatus
    const isUnassigned = !order.delivery?.assignedDelivery
    const isFuddiConfigured = (deliveryServiceType ?? 'fuddi') === 'fuddi'
    const agentCardClass = isUnassigned
        ? 'bg-gray-50 border-gray-200'
        : status === 'accepted'
            ? 'bg-green-50 border-green-200'
            : 'bg-yellow-50 border-yellow-200'

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onMouseDown={onClose}
        >
            <div
                className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="p-6">
                    <div className="flex justify-between items-start mb-6">
                        <h3 className="text-xl font-bold text-gray-900">Estado del Delivery</h3>
                        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg text-gray-400">
                            <i className="bi bi-x-lg"></i>
                        </button>
                    </div>

                    <div className="space-y-6">
                        {isUnassigned && isFuddiConfigured ? (
                            <div className="space-y-4">
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                    Selecciona el método de delivery
                                </p>

                                {/* Opción Autogestión */}
                                <div className={`p-4 rounded-xl border-2 transition-all ${showSelfSelect ? 'border-orange-500 bg-orange-50/50' : 'border-gray-200 hover:border-orange-300 bg-white'}`}>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (defaultDeliveryId && availableDeliveries.some(d => d.id === defaultDeliveryId)) {
                                                await onDeliveryAssign(order.id, defaultDeliveryId)
                                                onClose()
                                            } else {
                                                setShowSelfSelect(prev => !prev)
                                            }
                                        }}
                                        className="w-full text-left flex items-start gap-3"
                                    >
                                        <div className="w-10 h-10 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                                            <i className="bi bi-person-badge text-xl"></i>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-gray-900 text-sm">Autogestión</span>
                                                <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded bg-orange-100 text-orange-700">Tienda</span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                {defaultDeliveryId && availableDeliveries.some(d => d.id === defaultDeliveryId)
                                                    ? 'Asignar repartidor predeterminado de la tienda'
                                                    : 'Seleccionar repartidor propio de la tienda'}
                                            </p>
                                        </div>
                                    </button>

                                    {(showSelfSelect || !defaultDeliveryId || !availableDeliveries.some(d => d.id === defaultDeliveryId)) && canChangeDelivery && (
                                        <div className="mt-3 pt-3 border-t border-gray-200">
                                            <label className="block text-xs font-semibold text-gray-600 mb-1">Seleccionar repartidor propio:</label>
                                            <select
                                                value={order.delivery?.assignedDelivery || ''}
                                                onChange={async (e) => {
                                                    if (e.target.value) {
                                                        await onDeliveryAssign(order.id, e.target.value)
                                                        onClose()
                                                    }
                                                }}
                                                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
                                            >
                                                <option value="">Elegir repartidor...</option>
                                                {availableDeliveries.map(delivery => (
                                                    <option key={delivery.id} value={delivery.id}>{delivery.nombres}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>

                                {/* Opción Delivery Fuddi */}
                                <div className="p-4 rounded-xl border-2 border-gray-200 hover:border-blue-300 bg-white transition-all">
                                    <button
                                        type="button"
                                        disabled={isSearchingFuddi}
                                        onClick={async () => {
                                            setIsSearchingFuddi(true)
                                            try {
                                                if (onAutoAssignFuddi) {
                                                    await onAutoAssignFuddi(order)
                                                }
                                            } finally {
                                                setIsSearchingFuddi(false)
                                                onClose()
                                            }
                                        }}
                                        className="w-full text-left flex items-start gap-3"
                                    >
                                        <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                                            {isSearchingFuddi ? (
                                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                                            ) : (
                                                <i className="bi bi-scooter text-xl"></i>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-gray-900 text-sm">Delivery Fuddi</span>
                                                <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded bg-blue-100 text-blue-700">Red Fuddi</span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                Buscar repartidor de la red Fuddi automáticamente por zona de cobertura
                                            </p>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* Normal info when assigned or store has deliveryServiceType === 'self' */
                            <div className={`flex items-center gap-4 p-4 rounded-xl border ${agentCardClass}`}>
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${!order.delivery?.assignedDelivery ? 'bg-gray-100 text-gray-500' : status === 'accepted' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                    <i className="bi bi-person-fill text-2xl"></i>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs text-gray-500 font-medium">Repartidor Asignado</p>
                                    {canChangeDelivery ? (
                                        <select
                                            value={order.delivery?.assignedDelivery || ''}
                                            onChange={(e) => onDeliveryAssign(order.id, e.target.value)}
                                            className="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300"
                                        >
                                            <option value="">Asignar repartidor...</option>
                                            {availableDeliveries.map(delivery => (
                                                <option key={delivery.id} value={delivery.id}>{delivery.nombres}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <p className="text-lg font-bold text-gray-900 truncate">{deliveryAgent?.nombres || 'No identificado'}</p>
                                    )}
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className={`h-2 w-2 rounded-full ${!order.delivery?.assignedDelivery ? 'bg-gray-400' :
                                            status === 'accepted' ? 'bg-green-500' :
                                                status === 'rejected' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'
                                            }`} />
                                        <span className="text-sm font-bold text-gray-900">
                                            {!order.delivery?.assignedDelivery ? 'Sin asignar' :
                                                status === 'accepted' ? 'Confirmado' :
                                                    status === 'rejected' ? 'Rechazado' : 'Esperando confirmacion'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* WhatsApp Action */}
                        {order.delivery?.assignedDelivery && (
                            <button
                                onClick={onWhatsApp}
                                className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-200"
                            >
                                <i className="bi bi-whatsapp text-xl"></i>
                                Notificar por WhatsApp
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
