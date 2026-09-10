'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Order, Delivery } from '@/types'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'
import { getNextStatus } from '@/components/WhatsAppUtils'
import { Timestamp } from 'firebase/firestore'

// Helper to convert Firestore timestamp to Date
const toSafeDate = (val: any): Date => {
    if (!val) return new Date()
    if (val instanceof Timestamp) return val.toDate()
    if (typeof val.toDate === 'function') return val.toDate()
    if (val.seconds) return new Date(val.seconds * 1000)
    if (typeof val === 'string') {
        const dateOnlyMatch = val.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (dateOnlyMatch) {
            const [, year, month, day] = dateOnlyMatch
            return new Date(Number(year), Number(month) - 1, Number(day))
        }
        return new Date(val)
    }
    if (val instanceof Date) return val
    return new Date()
}

export const getStatusText = (status: string) => {
    switch (status) {
        case 'pending': return 'Pendiente'
        case 'borrador': return 'Borrador'
        case 'confirmed': return 'Confirmado'
        case 'preparing': return 'Preparando'
        case 'ready': return 'Listo para entrega'
        case 'on_way': return 'En camino'
        case 'delivered': return 'Entregado'
        case 'cancelled': return 'Descartado'
        default: return status
    }
}

export const getStatusColor = (status: string) => {
    switch (status) {
        case 'pending': return 'bg-yellow-100 text-yellow-800'
        case 'borrador': return 'bg-orange-100 text-orange-800'
        case 'confirmed': return 'bg-blue-100 text-blue-800'
        case 'preparing': return 'bg-purple-100 text-purple-800'
        case 'ready': return 'bg-green-100 text-green-800'
        case 'on_way': return 'bg-indigo-100 text-indigo-800'
        case 'delivered': return 'bg-gray-100 text-gray-800'
        case 'cancelled': return 'bg-red-100 text-red-800'
        default: return 'bg-gray-100 text-gray-800'
    }
}

// Helper to get the display time for an order
export const getOrderDisplayTime = (order: Order) => {
    try {
        if (order.timing?.scheduledTime) {
            return order.timing.scheduledTime;
        }
        const date = toSafeDate(order.createdAt);
        return date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '--:--';
    }
}

export const isActiveDashboardOrder = (order: Order) =>
    ['borrador', 'pending', 'confirmed', 'preparing', 'ready', 'on_way'].includes(order.status)

const getOrderReferenceDateForBadge = (order: Order) =>
    order.timing?.type === 'scheduled' && order.timing.scheduledDate
        ? toSafeDate(order.timing.scheduledDate)
        : toSafeDate(order.createdAt)

export const isPreviousActiveOrder = (order: Order) => {
    if (!isActiveDashboardOrder(order)) return false

    const today = new Date()
    const orderDate = getOrderReferenceDateForBadge(order)

    return orderDate.getFullYear() !== today.getFullYear()
        || orderDate.getMonth() !== today.getMonth()
        || orderDate.getDate() !== today.getDate()
}

export const getDeliveryCoordinates = (order: Order | null) => {
    if (!order?.delivery) return null
    if (typeof order.delivery.mapLocation?.lat === 'number' && typeof order.delivery.mapLocation?.lng === 'number') {
        return {
            lat: order.delivery.mapLocation.lat,
            lng: order.delivery.mapLocation.lng
        }
    }

    const latlong = order.delivery.latlong
    if (!latlong || latlong.startsWith('pluscode:')) return null
    const [lat, lng] = latlong.split(',').map(value => Number(value.trim()))

    if (Number.isNaN(lat) || Number.isNaN(lng)) return null
    return { lat, lng }
}

export const getDeliveryZone = (order: Order | null) => {
    const delivery = order?.delivery as any
    return delivery?.sector || delivery?.address || delivery?.zoneName || delivery?.coverageZoneName || 'No especificado'
}

const getActionIcon = (status: string) => {
    switch (status) {
        case 'preparing': return 'bi-fire text-purple-500'
        case 'ready': return 'bi-check2 text-green-600'
        case 'on_way': return 'bi-bicycle text-indigo-500'
        case 'delivered': return 'bi-stars text-purple-500'
        default: return 'bi-arrow-right'
    }
}

const getActionText = (status: string) => {
    switch (status) {
        case 'confirmed': return 'Confirmar'
        case 'preparing': return 'Preparando'
        case 'ready': return 'Listo para la entrega'
        case 'on_way': return 'En camino'
        case 'delivered': return 'Entregado'
        default: return getStatusText(status)
    }
}

export function OrderCard({
    order,
    availableDeliveries,
    onStatusChange,
    onDeliveryAssign,
    onPaymentEdit,
    onWhatsAppDelivery,
    onWhatsAppStore,
    onPrint,
    onDeliveryStatusClick,
    onEdit,
    onDelete,
    onCustomerClick,
    sectionKey,
    businessPhone,
    canChangeDelivery,
    canDeleteOrders,
    deliveryTimeMinutes,
    autoPrintOnConfirm,
    clientsWithNotes,
    businessName
}: {
    order: Order,
    availableDeliveries: Delivery[],
    onStatusChange: (orderId: string, newStatus: string, reason?: string) => void,
    onDeliveryAssign: (orderId: string, deliveryId: string) => void,
    onPaymentEdit: () => void,
    onWhatsAppDelivery: () => void,
    onWhatsAppStore?: () => void,
    onPrint: (silent?: boolean) => void,
    onDeliveryStatusClick: (order: Order) => void,
    onEdit: () => void,
    onDelete: () => void,
    onCustomerClick: () => void,
    sectionKey?: string,
    businessPhone?: string,
    canChangeDelivery?: boolean,
    canDeleteOrders?: boolean,
    deliveryTimeMinutes?: number,
    autoPrintOnConfirm?: boolean,
    clientsWithNotes?: Record<string, string>,
    businessName?: string
}) {
    const nextStatus = getNextStatus(order.status)
    const getOrderTargetDate = () => {
        const date = order.timing?.scheduledDate
            ? toSafeDate(order.timing.scheduledDate)
            : toSafeDate(order.createdAt)

        if (order.timing?.scheduledTime) {
            const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number)
            if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
                date.setHours(hours, minutes, 0, 0)
            }
        }

        return date
    }
    const isWithinDeliveryTimeWindow = () => {
        if (!['confirmed', 'preparing'].includes(order.status)) return false
        const windowMinutes = deliveryTimeMinutes ?? 30
        const diffMinutes = (getOrderTargetDate().getTime() - Date.now()) / 60000
        return diffMinutes <= windowMinutes
    }
    const showReadyAction = ['confirmed', 'preparing'].includes(order.status) && isWithinDeliveryTimeWindow()
    const primaryActionStatus = showReadyAction ? 'ready' : (order.status === 'confirmed' ? null : nextStatus)
    const primaryActionLabel = showReadyAction ? '¿Listo?' : (primaryActionStatus ? getActionText(primaryActionStatus) : '')
    const isDelivery = order.delivery?.type === 'delivery'
    const isPickup = order.delivery?.type === 'pickup'
    const [isExpanded, setIsExpanded] = useState(false)
    const [statusMenuOpen, setStatusMenuOpen] = useState(false)
    const [menuView, setMenuView] = useState<'main' | 'statuses' | 'whatsapp'>('main')
    const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
    const [discardReason, setDiscardReason] = useState('')
    const [deliveryInfoExpanded, setDeliveryInfoExpanded] = useState(false)
    const statusMenuRef = useRef<HTMLDivElement>(null)
    const assignedDelivery = availableDeliveries.find(d => d.id === order.delivery?.assignedDelivery)
    const deliveryLabel = order.delivery?.assignedDelivery
        ? assignedDelivery?.nombres || 'Delivery asignado'
        : 'Buscando delivery'
    const deliveryLabelClass = !order.delivery?.assignedDelivery
        ? 'bg-gray-100 text-gray-600 border-gray-200'
        : order.delivery?.acceptanceStatus === 'accepted'
            ? 'bg-green-100 text-green-700 border-green-200'
            : 'bg-yellow-100 text-yellow-800 border-yellow-200'
    const deliveryLabelTitle = !order.delivery?.assignedDelivery
        ? 'Buscando delivery'
        : order.delivery?.acceptanceStatus === 'accepted'
            ? 'Delivery confirmado'
            : 'Esperando confirmacion del delivery'
    const fulfillmentLabel = isPickup ? 'Retiro en tienda' : deliveryLabel
    const fulfillmentLabelClass = isPickup ? 'bg-blue-100 text-blue-700 border-blue-200' : deliveryLabelClass
    const fulfillmentLabelTitle = isPickup ? 'Retiro en tienda' : deliveryLabelTitle
    const showInlineStatusTag = sectionKey === 'delivered-group'
    const inlineStatusClass = order.status === 'ready'
        ? 'bg-green-50 text-green-700 border-green-200'
        : order.status === 'on_way'
            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
            : 'bg-gray-100 text-gray-700 border-gray-200'
    const deliveryCoordinates = getDeliveryCoordinates(order)
    const deliveryZone = getDeliveryZone(order)
    const deliveryCost = order.delivery?.deliveryCost || 0
    const deliveryMapsUrl = deliveryCoordinates
        ? `https://www.google.com/maps/search/?api=1&query=${deliveryCoordinates.lat},${deliveryCoordinates.lng}`
        : undefined
    const deliveryMapImageUrl = deliveryCoordinates
        ? `https://maps.googleapis.com/maps/api/staticmap?center=${deliveryCoordinates.lat},${deliveryCoordinates.lng}&zoom=16&size=600x180&scale=2&maptype=roadmap&markers=color:red%7C${deliveryCoordinates.lat},${deliveryCoordinates.lng}&key=${GOOGLE_MAPS_API_KEY}`
        : undefined

    useEffect(() => {
        if (confirmDiscardOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
        }
        return () => {
            document.body.style.overflow = ''
        }
    }, [confirmDiscardOpen])

    useEffect(() => {
        if (!statusMenuOpen) {
            setMenuView('main')
            return
        }

        const handleClickOutside = (event: MouseEvent) => {
            if (!statusMenuRef.current?.contains(event.target as Node)) {
                setStatusMenuOpen(false)
                setMenuView('main')
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [statusMenuOpen])

    const isUrgent = () => {
        if (['ready', 'delivered', 'completed', 'cancelled'].includes(order.status)) return false;

        const now = new Date();
        let targetDate = new Date();

        if (order.timing?.scheduledTime) {
            const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number);
            targetDate.setHours(hours, minutes, 0, 0);
        } else {
            return false;
        }

        const diffInMinutes = (targetDate.getTime() - now.getTime()) / 60000;
        return diffInMinutes <= 5;
    }

    const urgent = isUrgent();

    const sortedItems = [...(order.items || [])].sort((a: any, b: any) => {
        const priceA = (a.price || a.product?.price || 0) * a.quantity;
        const priceB = (b.price || b.product?.price || 0) * b.quantity;

        if (priceA === 0 && priceB !== 0) return 1;
        if (priceA !== 0 && priceB === 0) return -1;
        return 0;
    });

    return (
        <div className={`bg-white rounded-xl shadow-sm border border-gray-100 transition-all ${statusMenuOpen ? 'relative z-30' : ''} ${urgent ? 'animate-pulse border-red-300 ring-2 ring-red-100' : ''}`}>
            {confirmDiscardOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
                        onClick={() => {
                            setConfirmDiscardOpen(false)
                            setDiscardReason('')
                        }}
                    />

                    <div className="relative bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
                        <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mb-4">
                            <i className="bi bi-trash3 text-2xl"></i>
                        </div>

                        <h4 className="text-xl font-bold text-gray-900 mb-2">¿Descartar pedido?</h4>
                        <p className="text-sm text-gray-500 mb-6 px-2">
                            Se marcará como descartado y desaparecerá de la lista activa. Por favor selecciona el motivo.
                        </p>

                        <div className="w-full mb-6">
                            <label className="block text-xs uppercase tracking-wider text-gray-400 font-bold mb-2 text-left ml-1">
                                Motivo del descarte
                            </label>
                            <select
                                value={discardReason}
                                onChange={(e) => setDiscardReason(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-sm outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300 transition-all font-medium"
                            >
                                <option value="">Selecciona un motivo...</option>
                                <option value="Cliente no responde">Cliente no responde</option>
                                <option value="Sin stock de productos">Sin stock de productos</option>
                                <option value="Fuera de zona de cobertura">Fuera de zona de cobertura</option>
                                <option value="Pedido duplicado">Pedido duplicado</option>
                                <option value="Fallo en el pago">Fallo en el pago</option>
                                <option value="Otro">Otro motivo</option>
                            </select>
                        </div>

                        <div className="flex gap-3 w-full">
                            <button
                                onClick={() => {
                                    setConfirmDiscardOpen(false)
                                    setDiscardReason('')
                                }}
                                className="flex-1 py-3 text-sm font-bold text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    onStatusChange(order.id, 'cancelled', discardReason || 'Sin motivo especificado')
                                    setConfirmDiscardOpen(false)
                                    setDiscardReason('')
                                    setStatusMenuOpen(false)
                                }}
                                className="flex-1 py-3 text-sm font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                                disabled={!discardReason}
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Card Header: Customer info & time */}
            <div
                className={`px-4 py-3 border-b cursor-pointer transition-colors ${isExpanded ? 'border-gray-200 bg-gray-200 hover:bg-gray-200' : 'border-gray-50 bg-gray-55/50 hover:bg-gray-100'}`}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-3">
                        <div className="flex flex-col items-center shrink-0 mt-1 mr-1">
                            <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 text-xs transform transition-transform duration-200`}></i>
                            {!order.createdByAdmin && (
                                <i className="bi bi-phone text-blue-500 text-[10px] mt-0.5" title="Pedido del cliente (Checkout)"></i>
                            )}
                        </div>

                        <div className="flex flex-col">
                            <span className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                                {order.customer?.name || "Cliente"}
                                {Boolean(order.customer?.telegramChatId || (order as any).telegramChatId) && (
                                    <i 
                                        className="bi bi-patch-check-fill text-[#229ED9] text-sm shrink-0" 
                                        title="Cliente con Telegram vinculado"
                                    ></i>
                                )}
                                {order.customer?.phone && clientsWithNotes && clientsWithNotes[order.customer.phone] && (
                                    <i 
                                        className="bi bi-exclamation-circle-fill text-amber-500 animate-pulse cursor-help" 
                                        title={`Nota de cliente: ${clientsWithNotes[order.customer.phone]}`}
                                    ></i>
                                )}
                            </span>
                            {businessName && (
                                <span className="text-[10px] text-red-600 font-bold uppercase tracking-wider mb-0.5 leading-none">
                                    {businessName}
                                </span>
                            )}

                            <div className="flex items-center gap-2 mt-0.5">
                                <i className={`bi ${order.timing?.type === 'scheduled' ? 'bi-clock text-blue-600' : 'bi-lightning-fill text-yellow-500'}`}></i>
                                <span className="font-mono text-sm sm:font-medium text-gray-600">
                                    {getOrderDisplayTime(order)}
                                </span>
                                {isPreviousActiveOrder(order) && (
                                    <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold leading-none bg-amber-100 text-amber-800 border border-amber-200">
                                        Pendiente anterior
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        {primaryActionStatus && (
                            <button
                                onClick={() => {
                                    if (primaryActionStatus === 'confirmed') {
                                        onStatusChange(order.id, 'confirmed');
                                        if (autoPrintOnConfirm) {
                                            setTimeout(() => {
                                                onPrint(true);
                                            }, 500);
                                        }
                                    } else {
                                        onStatusChange(order.id, primaryActionStatus);
                                    }
                                }}
                                className={`flex items-center gap-1 rounded-lg transition-colors ${showReadyAction
                                    ? 'px-2 py-1.5 text-xs font-bold text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                                    : primaryActionStatus === 'confirmed'
                                        ? 'px-3 py-1.5 text-xs font-bold bg-green-600 text-white hover:bg-green-700 shadow-sm'
                                        : 'p-1.5 text-lg hover:bg-white hover:shadow-md'
                                    }`}
                                title={primaryActionLabel}
                            >
                                {(primaryActionStatus === 'confirmed' || showReadyAction) ? (
                                    <>
                                        <span>{primaryActionLabel}</span>
                                        {!showReadyAction && <i className="bi bi-check2-circle"></i>}
                                    </>
                                ) : (
                                    <i className={`bi ${getActionIcon(primaryActionStatus)}`}></i>
                                )}
                            </button>
                        )}

                        {order.status === 'pending' && (
                            <button
                                onClick={() => setConfirmDiscardOpen(true)}
                                className="p-1.5 text-lg text-gray-400 bg-gray-50 border border-gray-100 rounded-lg hover:bg-gray-100 transition-colors shadow-sm"
                                title="Descartar pedido"
                            >
                                <i className="bi bi-x-lg"></i>
                            </button>
                        )}

                        {/* Print Button */}
                        <button
                            onClick={() => onPrint()}
                            className="p-1.5 text-lg text-gray-500 rounded-lg transition-all hover:bg-gray-200/60 hover:text-gray-800"
                            title="Imprimir ticket"
                        >
                            <i className="bi bi-printer"></i>
                        </button>

                        {/* Status Select Menu */}
                        {showInlineStatusTag ? (
                            <span
                                className={`inline-flex h-7 items-center rounded-lg border px-2 text-[11px] font-bold leading-none ${inlineStatusClass}`}
                                title={getStatusText(order.status)}
                            >
                                {getStatusText(order.status)}
                            </span>
                        ) : (
                            <div className="relative" ref={statusMenuRef}>
                                <button
                                    onClick={() => setStatusMenuOpen(!statusMenuOpen)}
                                    className={`p-1.5 text-lg rounded-lg transition-all hover:bg-gray-100 ${statusMenuOpen ? 'bg-gray-100' : ''}`}
                                    title="Opciones del pedido"
                                >
                                    <i className="bi bi-three-dots-vertical"></i>
                                </button>

                                {statusMenuOpen && (
                                    <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-xl border border-gray-100 z-30 py-1.5 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                                        {menuView === 'main' && (
                                            <div className="animate-in slide-in-from-left-2 duration-150">
                                                <button
                                                    onClick={() => {
                                                        onEdit()
                                                        setStatusMenuOpen(false)
                                                    }}
                                                    className="w-full text-left px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2.5 font-medium"
                                                >
                                                    <i className="bi bi-pencil text-blue-500 text-base"></i>
                                                    Editar
                                                </button>

                                                <button
                                                    onClick={() => setMenuView('whatsapp')}
                                                    className="w-full text-left px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-between font-medium group"
                                                >
                                                    <div className="flex items-center gap-2.5">
                                                        <i className="bi bi-whatsapp text-green-500 text-base"></i>
                                                        <span>WhatsApp</span>
                                                    </div>
                                                    <i className="bi bi-chevron-right text-xs text-gray-400 group-hover:translate-x-0.5 transition-transform"></i>
                                                </button>

                                                <button
                                                    onClick={() => {
                                                        if (canDeleteOrders !== false) {
                                                            onDelete()
                                                        } else {
                                                            setConfirmDiscardOpen(true)
                                                        }
                                                        setStatusMenuOpen(false)
                                                    }}
                                                    className="w-full text-left px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2.5 font-medium"
                                                >
                                                    <i className="bi bi-trash text-red-500 text-base"></i>
                                                    Eliminar
                                                </button>

                                                <div className="my-1 border-t border-gray-100"></div>

                                                <button
                                                    onClick={() => setMenuView('statuses')}
                                                    className="w-full text-left px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-between font-medium group"
                                                >
                                                    <div className="flex items-center gap-2.5">
                                                        <i className="bi bi-arrow-repeat text-purple-500 text-base"></i>
                                                        <span>Estados</span>
                                                    </div>
                                                    <i className="bi bi-chevron-right text-xs text-gray-400 group-hover:translate-x-0.5 transition-transform"></i>
                                                </button>
                                            </div>
                                        )}

                                        {menuView === 'whatsapp' && (
                                            <div className="animate-in slide-in-from-right-2 duration-150">
                                                <button
                                                    onClick={() => setMenuView('main')}
                                                    className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors flex items-center gap-1.5 font-semibold border-b border-gray-100 mb-1"
                                                >
                                                    <i className="bi bi-arrow-left text-sm"></i>
                                                    <span>Volver</span>
                                                </button>

                                                <button
                                                    onClick={() => {
                                                        onCustomerClick()
                                                        setStatusMenuOpen(false)
                                                    }}
                                                    className="w-full text-left px-3.5 py-2 text-sm text-gray-700 hover:bg-green-50 hover:text-green-700 transition-colors flex items-center gap-2.5 font-medium"
                                                >
                                                    <i className="bi bi-person-check text-green-600 text-base"></i>
                                                    Cliente (Comprobante)
                                                </button>

                                                <button
                                                    onClick={() => {
                                                        onWhatsAppDelivery()
                                                        setStatusMenuOpen(false)
                                                    }}
                                                    className="w-full text-left px-3.5 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-center gap-2.5 font-medium"
                                                >
                                                    <i className="bi bi-bicycle text-indigo-500 text-base"></i>
                                                    Delivery
                                                </button>

                                                <button
                                                    onClick={() => {
                                                        if (onWhatsAppStore) onWhatsAppStore()
                                                        setStatusMenuOpen(false)
                                                    }}
                                                    className="w-full text-left px-3.5 py-2 text-sm text-gray-700 hover:bg-red-50 hover:text-red-700 transition-colors flex items-center gap-2.5 font-medium"
                                                >
                                                    <i className="bi bi-shop text-red-500 text-base"></i>
                                                    Tienda
                                                </button>
                                            </div>
                                        )}

                                        {menuView === 'statuses' && (
                                            <div className="animate-in slide-in-from-right-2 duration-150">
                                                <button
                                                    onClick={() => setMenuView('main')}
                                                    className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors flex items-center gap-1.5 font-semibold border-b border-gray-100 mb-1"
                                                >
                                                    <i className="bi bi-arrow-left text-sm"></i>
                                                    <span>Volver</span>
                                                </button>

                                                <button
                                                    onClick={() => {
                                                        onStatusChange(order.id, 'preparing')
                                                        setStatusMenuOpen(false)
                                                    }}
                                                    className="w-full text-left px-3.5 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700 transition-colors flex items-center gap-2.5 font-medium"
                                                >
                                                    <i className="bi bi-fire text-purple-500 text-base"></i>
                                                    Preparando
                                                </button>

                                                <button
                                                    onClick={() => {
                                                        onStatusChange(order.id, 'ready')
                                                        setStatusMenuOpen(false)
                                                    }}
                                                    className="w-full text-left px-3.5 py-2 text-sm text-gray-700 hover:bg-green-50 hover:text-green-700 transition-colors flex items-center gap-2.5 font-medium"
                                                >
                                                    <i className="bi bi-box-seam text-green-500 text-base"></i>
                                                    Listo para entrega
                                                </button>

                                                <button
                                                    onClick={() => {
                                                        onStatusChange(order.id, 'delivered')
                                                        setStatusMenuOpen(false)
                                                    }}
                                                    className="w-full text-left px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors flex items-center gap-2.5 font-medium"
                                                >
                                                    <i className="bi bi-check-all text-gray-500 text-base"></i>
                                                    Entregado
                                                </button>

                                                <button
                                                    onClick={() => {
                                                        setConfirmDiscardOpen(true)
                                                        setStatusMenuOpen(false)
                                                    }}
                                                    className="w-full text-left px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2.5 font-medium border-t border-gray-50 mt-1"
                                                >
                                                    <i className="bi bi-x-circle text-red-500 text-base"></i>
                                                    Descartado
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {!isExpanded && (
                    <div className="flex flex-col gap-0.5">
                        {sortedItems.map((item: any, idx) => (
                            <div key={idx} className="text-lg sm:text-sm leading-tight text-gray-600">
                                {item.quantity}x {item.variant || item.product?.name || item.name}
                            </div>
                        ))}
                    </div>
                )}

                {(isDelivery || isPickup) && (
                    <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            onClick={() => {
                                if (isDelivery) {
                                    onDeliveryStatusClick(order)
                                }
                            }}
                            className={`flex h-[20px] min-h-[20px] max-h-[20px] w-36 items-center justify-center truncate rounded-[3px] border px-2 py-0 text-[11px] font-semibold leading-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] transition-colors ${fulfillmentLabelClass} ${isDelivery ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}`}
                            title={fulfillmentLabelTitle}
                        >
                            {fulfillmentLabel}
                        </button>
                    </div>
                )}
            </div>

            {/* Card Body */}
            {isExpanded && (
                <div className="p-4 bg-white animate-in slide-in-from-top-2 duration-200">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex-1 pr-2">
                            {isDelivery && (
                                <div className="space-y-2">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setDeliveryInfoExpanded(prev => !prev)
                                        }}
                                        className="group flex w-full max-w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-gray-600 transition-colors hover:bg-red-50 hover:text-red-700"
                                        title={deliveryInfoExpanded ? 'Ocultar datos de entrega' : 'Ver datos de entrega'}
                                        aria-expanded={deliveryInfoExpanded}
                                    >
                                        <i className="bi bi-geo-alt-fill mt-0.5 flex-shrink-0 text-gray-400 group-hover:text-red-500"></i>
                                        <span className="line-clamp-2">{order.delivery?.references || (order.delivery as any)?.reference || "Ubicación"}</span>
                                        <i className={`bi bi-chevron-${deliveryInfoExpanded ? 'up' : 'down'} mt-0.5 flex-shrink-0 text-[11px] text-gray-300 group-hover:text-red-500`}></i>
                                    </button>
                                    
                                    {deliveryInfoExpanded && (
                                        <div className="ml-2 overflow-hidden rounded-xl border border-red-100 bg-red-50/50 animate-in slide-in-from-top-1 duration-150">
                                            {deliveryMapImageUrl && deliveryMapsUrl ? (
                                                <a
                                                    href={deliveryMapsUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="block"
                                                    title="Abrir ubicación en Maps"
                                                >
                                                    <img
                                                        src={deliveryMapImageUrl}
                                                        alt="Mapa de entrega"
                                                        className="h-36 w-full object-cover"
                                                        loading="lazy"
                                                    />
                                                </a>
                                            ) : (
                                                <div className="flex h-24 items-center justify-center gap-2 text-sm font-medium text-gray-500">
                                                    <i className="bi bi-map text-gray-300"></i>
                                                    Sin coordenadas
                                                </div>
                                            )}

                                            <div className="grid grid-cols-2 gap-2 p-3 text-sm">
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Zona</p>
                                                    <p className="font-semibold text-gray-900">{deliveryZone}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Envío</p>
                                                    <p className="font-semibold text-gray-900">${deliveryCost.toFixed(2)}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {order.notas && order.notas.trim() && (
                        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <div className="flex items-start gap-2">
                                <i className="bi bi-sticky text-amber-600 mt-0.5 flex-shrink-0"></i>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-amber-800 mb-1">Notas</p>
                                    <p className="text-sm text-amber-700 whitespace-pre-wrap">{order.notas}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {order.notaImageUrl && (
                        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <div className="flex items-start gap-2">
                                <i className="bi bi-image text-amber-600 mt-0.5 flex-shrink-0"></i>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-amber-800 mb-2">Imagen de nota</p>
                                    <img src={order.notaImageUrl} alt="Imagen de nota" className="max-h-48 w-full object-contain rounded-md border border-amber-200 bg-white" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Product items list */}
                    <div className="space-y-2 mb-4">
                        {order.items?.map((item: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-base">
                                <span className="text-gray-700">
                                    <span className="font-medium text-gray-900">{item.quantity}x</span> {item.variant || item.product?.name || item.name}
                                </span>
                                <div className="flex flex-col items-end">
                                    <span className="text-emerald-600 font-bold text-sm">
                                        ${((item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0))) * item.quantity).toFixed(2)}
                                    </span>
                                    {((item.price || item.product?.price || 0) > (item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0)))) && (
                                        <span className="text-[9px] text-gray-400 font-medium">Público: ${((item.price || item.product?.price || 0) * item.quantity).toFixed(2)}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-dashed border-gray-200 my-3"></div>

                    {/* Total info */}
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={onPaymentEdit}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm font-medium transition-colors ${order.payment?.paymentStatus === 'paid'
                                    ? 'bg-green-100 text-green-700'
                                    : order.payment?.paymentStatus === 'validating'
                                        ? 'bg-yellow-100 text-yellow-700'
                                        : 'bg-red-100 text-red-700'
                                    }`}
                            >
                                <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-bank' :
                                    order.payment?.method === 'mixed' ? 'bi-cash-coin' : 'bi-cash'
                                    }`}></i>
                                <div className="flex flex-col items-start leading-tight">
                                    <span className="text-emerald-600 font-black">${(order.items?.reduce((acc, item) => acc + ((item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0))) * item.quantity), 0) || order.total || 0).toFixed(2)}</span>
                                    {((order.total || 0) > (order.items?.reduce((acc, item) => acc + ((item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0))) * item.quantity), 0) || order.total || 0)) && (
                                        <span className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter">Público: ${(order.total || 0).toFixed(2)}</span>
                                    )}
                                </div>
                                <i className="bi bi-pencil-square text-xs opacity-50 ml-1"></i>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
