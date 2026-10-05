'use client'

import React, { useState } from 'react'
import { Order, Delivery, Business } from '@/types'
import { buildDeliveryWhatsAppMessage } from '@/components/WhatsAppUtils'

export interface DeliveryStatusModalProps {
    isOpen: boolean
    onClose: () => void
    order: Order | null
    deliveryAgent?: Delivery
    availableDeliveries: Delivery[]
    canChangeDelivery: boolean
    onDeliveryAssign: (id: string, deliveryId: string) => void | Promise<void>
    onWhatsApp: () => void
    business?: Business | null
    deliveryServiceType?: 'self' | 'fuddi'
    defaultDeliveryId?: string
    onUpdateDefaultDelivery?: (deliveryId: string | undefined) => void | Promise<void>
    onAutoAssignFuddi?: (order: Order) => void | Promise<void>
}

export function DeliveryStatusModal({
    isOpen,
    onClose,
    order,
    deliveryAgent,
    availableDeliveries,
    canChangeDelivery,
    onDeliveryAssign,
    onWhatsApp,
    business,
    deliveryServiceType,
    defaultDeliveryId,
    onUpdateDefaultDelivery,
    onAutoAssignFuddi
}: DeliveryStatusModalProps) {
    const [isSearchingFuddi, setIsSearchingFuddi] = useState(false)
    const [isAssigning, setIsAssigning] = useState(false)
    const [isEditingDefault, setIsEditingDefault] = useState(false)
    const [isSavingDefault, setIsSavingDefault] = useState(false)
    const [isCopied, setIsCopied] = useState(false)

    if (!isOpen || !order) return null

    const status = order.delivery?.acceptanceStatus
    const isUnassigned = !order.delivery?.assignedDelivery
    const isFuddiConfigured = (deliveryServiceType ?? 'fuddi') === 'fuddi'

    const defaultDelivery = availableDeliveries.find(d => d.id === defaultDeliveryId)
    const isAssignedToDefault = Boolean(
        defaultDelivery && order.delivery?.assignedDelivery === defaultDelivery.id
    )

    const handleAssignDefault = async () => {
        if (!order || !defaultDelivery) return
        setIsAssigning(true)
        try {
            await onDeliveryAssign(order.id, defaultDelivery.id)
            onClose()
        } finally {
            setIsAssigning(false)
        }
    }

    const handleDefaultChange = async (newId: string) => {
        if (!onUpdateDefaultDelivery) return
        setIsSavingDefault(true)
        try {
            await onUpdateDefaultDelivery(newId || undefined)
            setIsEditingDefault(false)
        } finally {
            setIsSavingDefault(false)
        }
    }

    const handleCopyMessage = async () => {
        if (!order) return
        try {
            const text = buildDeliveryWhatsAppMessage(order, business || null)
            await navigator.clipboard.writeText(text)
            setIsCopied(true)
            setTimeout(() => setIsCopied(false), 2000)
        } catch (e) {
            console.error('Error al copiar mensaje al portapapeles:', e)
        }
    }

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
            onMouseDown={onClose}
        >
            <div
                className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-xl border border-gray-100 animate-in fade-in zoom-in duration-150"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="p-5">
                    {/* Header Minimalista */}
                    <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100">
                        <div className="flex items-center gap-2">
                            <i className="bi bi-bicycle text-gray-700 text-base"></i>
                            <h3 className="text-sm font-black text-gray-900 tracking-tight">
                                Asignar Delivery
                            </h3>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                            title="Cerrar"
                        >
                            <i className="bi bi-x-lg text-xs"></i>
                        </button>
                    </div>

                    <div className="space-y-3.5">
                        {/* 1. Botón / Barra de Delivery Predeterminado */}
                        <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-2.5">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <i className="bi bi-star-fill text-amber-500 text-sm shrink-0"></i>
                                    {isEditingDefault ? (
                                        <div className="flex-1 flex items-center gap-1.5">
                                            <select
                                                autoFocus
                                                value={defaultDeliveryId || ''}
                                                disabled={isSavingDefault}
                                                onChange={(e) => handleDefaultChange(e.target.value)}
                                                className="w-full bg-white border border-amber-300 rounded-lg px-2 py-1 text-xs font-bold text-gray-800 outline-none focus:ring-1 focus:ring-amber-400"
                                            >
                                                <option value="">-- Sin predeterminado --</option>
                                                {availableDeliveries.map(d => (
                                                    <option key={d.id} value={d.id}>{d.nombres}</option>
                                                ))}
                                            </select>
                                            {isSavingDefault ? (
                                                <span className="animate-spin h-3 w-3 rounded-full border-2 border-amber-600 border-t-transparent shrink-0"></span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setIsEditingDefault(false)}
                                                    className="p-1 text-gray-400 hover:text-gray-600 rounded"
                                                    title="Cancelar"
                                                >
                                                    <i className="bi bi-x text-sm"></i>
                                                </button>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wide leading-none">
                                                Predeterminado
                                            </p>
                                            <p className="text-xs font-black text-gray-900 truncate mt-0.5">
                                                {defaultDelivery ? defaultDelivery.nombres : 'No configurado'}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Acciones del predeterminado */}
                                {!isEditingDefault && (
                                    <div className="flex items-center gap-1 shrink-0">
                                        {defaultDelivery && (
                                            isAssignedToDefault ? (
                                                <span
                                                    className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-800 rounded-lg text-[11px] font-bold"
                                                    title="Ya asignado a esta orden"
                                                >
                                                    <i className="bi bi-check-circle-fill text-xs text-emerald-600"></i>
                                                    <span>Asignado</span>
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    disabled={isAssigning}
                                                    onClick={handleAssignDefault}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-lg text-xs font-bold transition-all shadow-2xs"
                                                    title={`Asignar a ${defaultDelivery.nombres}`}
                                                >
                                                    {isAssigning ? (
                                                        <span className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
                                                    ) : (
                                                        <i className="bi bi-lightning-charge-fill text-xs"></i>
                                                    )}
                                                    <span>Asignar</span>
                                                </button>
                                            )
                                        )}

                                        {canChangeDelivery && onUpdateDefaultDelivery && (
                                            <button
                                                type="button"
                                                onClick={() => setIsEditingDefault(true)}
                                                className="p-1.5 text-amber-700 hover:text-amber-900 hover:bg-amber-100 rounded-lg transition-colors"
                                                title="Ajustar repartidor predeterminado"
                                            >
                                                <i className="bi bi-gear text-xs"></i>
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 2. Selector de Repartidor de la Orden */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5 px-0.5">
                                <label className="text-xs font-bold text-gray-600 flex items-center gap-1.5">
                                    <i className="bi bi-person text-gray-400"></i>
                                    <span>Repartidor de la orden</span>
                                </label>
                                {!isUnassigned && (
                                    <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                                        status === 'accepted' ? 'text-green-600' :
                                        status === 'rejected' ? 'text-red-500' : 'text-amber-600'
                                    }`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${
                                            status === 'accepted' ? 'bg-green-500' :
                                            status === 'rejected' ? 'bg-red-500' : 'bg-amber-500 animate-pulse'
                                        }`} />
                                        {status === 'accepted' ? 'Confirmado' : status === 'rejected' ? 'Rechazado' : 'Pendiente'}
                                    </span>
                                )}
                            </div>

                            <select
                                value={order.delivery?.assignedDelivery || ''}
                                onChange={async (e) => {
                                    await onDeliveryAssign(order.id, e.target.value)
                                }}
                                disabled={!canChangeDelivery}
                                className="w-full bg-gray-50 hover:bg-gray-100/80 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-gray-300 focus:bg-white transition-all disabled:opacity-60"
                            >
                                <option value="">-- Sin asignar --</option>
                                {availableDeliveries.map(d => (
                                    <option key={d.id} value={d.id}>
                                        {d.nombres} {d.id === defaultDeliveryId ? '★ (Predeterminado)' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* 3. Opción Red Fuddi (si está configurado y sin asignar) */}
                        {isFuddiConfigured && isUnassigned && (
                            <button
                                type="button"
                                disabled={isSearchingFuddi}
                                onClick={async () => {
                                    setIsSearchingFuddi(true)
                                    try {
                                        if (onAutoAssignFuddi) await onAutoAssignFuddi(order)
                                    } finally {
                                        setIsSearchingFuddi(false)
                                        onClose()
                                    }
                                }}
                                className="w-full flex items-center justify-center gap-2 py-2 px-3 border border-blue-200 bg-blue-50/50 hover:bg-blue-100/70 active:scale-98 text-blue-700 rounded-xl text-xs font-bold transition-all"
                            >
                                {isSearchingFuddi ? (
                                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent" />
                                ) : (
                                    <i className="bi bi-scooter text-sm"></i>
                                )}
                                <span>Buscar en Red Fuddi</span>
                            </button>
                        )}

                        {/* 4. Notificar por WhatsApp + Copiar mensaje (si está asignado) */}
                        {order.delivery?.assignedDelivery && (
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={onWhatsApp}
                                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-700 active:scale-98 text-white rounded-xl font-bold text-xs transition-all shadow-xs"
                                >
                                    <i className="bi bi-whatsapp text-sm"></i>
                                    <span>Notificar por WhatsApp</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCopyMessage}
                                    className={`p-2.5 rounded-xl border transition-all active:scale-95 shrink-0 flex items-center justify-center ${
                                        isCopied
                                            ? 'bg-emerald-50 border-emerald-300 text-emerald-600'
                                            : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600 hover:text-gray-900'
                                    }`}
                                    title={isCopied ? '¡Mensaje copiado!' : 'Copiar mensaje para el delivery'}
                                >
                                    <i className={`bi ${isCopied ? 'bi-clipboard-check text-emerald-600' : 'bi-clipboard'} text-sm`}></i>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
