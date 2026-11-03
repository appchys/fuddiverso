'use client'

import React, { useState } from 'react'
import { Order, Delivery, Business } from '@/types'
import { Timestamp } from 'firebase/firestore'
import { OrderCard, getStatusText } from './OrderCard'

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

const getOrderDate = (order: Order): Date => {
    if (order.timing?.type === 'scheduled' && order.timing.scheduledDate) {
        const date = toSafeDate(order.timing.scheduledDate)
        if (order.timing.scheduledTime) {
            const [h, m] = order.timing.scheduledTime.split(':').map(Number)
            if (!isNaN(h) && !isNaN(m)) {
                date.setHours(h, m, 0, 0)
            }
        }
        return date
    }
    return toSafeDate(order.createdAt)
}

const getDateGroupInfo = (date: Date) => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    const diffTime = target.getTime() - today.getTime()
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

    const formattedDate = date.toLocaleDateString('es-EC', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
    })

    if (diffDays === 0) {
        return {
            title: 'Hoy',
            subtitle: formattedDate,
            badgeType: 'today' as const
        }
    } else if (diffDays === -1) {
        return {
            title: 'Ayer',
            subtitle: formattedDate,
            badgeType: 'yesterday' as const
        }
    } else if (diffDays === 1) {
        return {
            title: 'Mañana',
            subtitle: formattedDate,
            badgeType: 'future' as const
        }
    } else if (diffDays < -1) {
        return {
            title: formattedDate,
            badgeType: 'past' as const
        }
    } else {
        return {
            title: formattedDate,
            badgeType: 'future' as const
        }
    }
}

interface DateOrderGroup {
    dateKey: string
    date: Date
    labelInfo: ReturnType<typeof getDateGroupInfo>
    orders: Order[]
}

const groupStatusOrdersByDate = (ordersList: Order[], isDescOrder: boolean): DateOrderGroup[] => {
    const map = new Map<string, DateOrderGroup>()

    ordersList.forEach(order => {
        const date = getOrderDate(order)
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

        if (!map.has(dateKey)) {
            const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
            map.set(dateKey, {
                dateKey,
                date: startOfDay,
                labelInfo: getDateGroupInfo(startOfDay),
                orders: []
            })
        }
        map.get(dateKey)!.orders.push(order)
    })

    const groups = Array.from(map.values())

    // En entregados y cancelados, las fechas más recientes arriba.
    // Para estados activos, las fechas más antiguas primero para priorizar pedidos pendientes.
    groups.sort((a, b) => {
        return isDescOrder
            ? b.date.getTime() - a.date.getTime()
            : a.date.getTime() - b.date.getTime()
    })

    // Dentro de cada grupo por fecha, ordenar los pedidos por hora
    groups.forEach(group => {
        group.orders.sort((a, b) => {
            const timeA = getOrderDate(a).getTime()
            const timeB = getOrderDate(b).getTime()
            return isDescOrder ? timeB - timeA : timeA - timeB
        })
    })

    return groups
}

function CollapsibleSection({
    title,
    count,
    status,
    children,
    defaultExpanded = true
}: {
    title: string,
    count: number | string,
    status: string,
    children: React.ReactNode,
    defaultExpanded?: boolean
}) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded)

    const getDotColor = (s: string) => {
        switch (s) {
            case 'pending': return 'bg-yellow-500 shadow-yellow-200'
            case 'borrador': return 'bg-orange-400 shadow-orange-200'
            case 'confirmed': return 'bg-blue-500 shadow-blue-200'
            case 'preparing': return 'bg-purple-500 shadow-purple-200'
            case 'ready': return 'bg-green-500 shadow-green-200'
            case 'on_way': return 'bg-indigo-500 shadow-indigo-200'
            case 'delivered': return 'bg-gray-500 shadow-gray-200'
            case 'cancelled': return 'bg-red-500 shadow-red-200'
            default: return 'bg-gray-400'
        }
    }

    return (
        <div className="mb-4 overflow-visible rounded-xl bg-transparent">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-3 flex justify-between items-center bg-gray-100 hover:bg-gray-200 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full shadow-sm ${getDotColor(status)}`}></span>
                    <h3 className="font-bold text-gray-800 text-lg">{title}</h3>
                    <span className="bg-gray-200 border border-gray-300 text-gray-700 text-xs font-bold px-2.5 py-0.5 rounded-full">{count}</span>
                </div>
                <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 transition-transform duration-200`}></i>
            </button>

            {isExpanded && (
                <div className="p-4 space-y-4 bg-gray-100 animate-in slide-in-from-top-2 duration-200">
                    {children}
                </div>
            )}
        </div>
    )
}

export default function OrderStatusColumn({
    statuses,
    orders,
    availableDeliveries,
    handleStatusChange,
    handleDeliveryAssignment,
    handlePaymentClick,
    handleSendWhatsAppToDelivery,
    handleSendWhatsAppToStore,
    handlePrint,
    setSelectedOrderForStatusModal,
    setDeliveryStatusModalOpen,
    setSelectedOrderForEdit,
    setManualSidebarMode,
    setManualOrderSidebarOpen,
    handleDeleteOrder,
    setSelectedOrderForCustomerContact,
    setCustomerContactModalOpen,
    business,
    canChangeDelivery,
    canDeleteOrders,
    deliveryTimeMinutes,
    autoPrintOnConfirm,
    clientsWithNotes,
    businesses,
    selectedBusinessId
}: any) {
    return (
        <>
            {statuses.map((statusConfig: any) => {
                const groupedStatuses = typeof statusConfig === 'string' ? [statusConfig] : statusConfig.statuses;
                const sectionKey = typeof statusConfig === 'string' ? statusConfig : statusConfig.key;
                const sectionTitle = typeof statusConfig === 'string' ? getStatusText(statusConfig) : statusConfig.title;
                const sectionStatusColor = typeof statusConfig === 'string' ? statusConfig : statusConfig.statusColor || groupedStatuses[0];
                const sectionDefaultExpanded = typeof statusConfig === 'string' || statusConfig.defaultExpanded === undefined
                    ? !groupedStatuses.every((status: string) => ['delivered', 'cancelled'].includes(status))
                    : statusConfig.defaultExpanded;
                const statusOrders = orders.filter((o: any) => groupedStatuses.includes(o.status));
                const countStatusTotal = typeof statusConfig === 'string' || !statusConfig.countStatus
                    ? null
                    : statusOrders.filter((o: any) => o.status === statusConfig.countStatus).length;
                const sectionCount = countStatusTotal == null || countStatusTotal === statusOrders.length
                    ? statusOrders.length
                    : `${countStatusTotal} de ${statusOrders.length}`;
                if (statusOrders.length === 0) return null;

                const isDesc = groupedStatuses.every((s: string) => ['delivered', 'cancelled'].includes(s));
                const dateGroups = groupStatusOrdersByDate(statusOrders, isDesc);

                return (
                    <CollapsibleSection
                        key={sectionKey}
                        title={sectionTitle}
                        count={sectionCount}
                        status={sectionStatusColor}
                        defaultExpanded={sectionDefaultExpanded}
                    >
                        {dateGroups.map(group => {
                            const { title, subtitle, badgeType } = group.labelInfo;
                            return (
                                <div key={group.dateKey} className="space-y-3">
                                    {/* Encabezado elegante de agrupación por fecha */}
                                    <div className="pt-1 pb-0.5 first:pt-0">
                                        <div className="flex items-center gap-2">
                                            <div className="h-px flex-1 bg-gray-200/90"></div>
                                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border shadow-xs ${
                                                badgeType === 'today'
                                                    ? 'bg-white text-gray-800 border-gray-200'
                                                    : badgeType === 'yesterday' || badgeType === 'past'
                                                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                                                        : 'bg-blue-50 text-blue-700 border-blue-200'
                                            }`}>
                                                <i className={`bi ${
                                                    badgeType === 'today'
                                                        ? 'bi-calendar-check text-gray-500'
                                                        : badgeType === 'yesterday' || badgeType === 'past'
                                                            ? 'bi-clock-history text-amber-600'
                                                            : 'bi-calendar-event text-blue-500'
                                                } text-xs`}></i>
                                                <span className="capitalize">{title}</span>
                                                {subtitle && <span className="text-[10px] opacity-75 font-medium">({subtitle})</span>}
                                                <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-black/5 font-mono">
                                                    {group.orders.length}
                                                </span>
                                            </div>
                                            <div className="h-px flex-1 bg-gray-200/90"></div>
                                        </div>
                                    </div>

                                    {/* Lista de pedidos de la fecha */}
                                    <div className="space-y-3">
                                        {group.orders.map((order: any) => {
                                            const bizName = selectedBusinessId === 'all'
                                                ? businesses?.find((b: any) => b.id === order.businessId)?.name
                                                : undefined
                                            return (
                                                <OrderCard
                                                    key={order.id}
                                                    order={order}
                                                    availableDeliveries={availableDeliveries}
                                                    onStatusChange={handleStatusChange}
                                                    onDeliveryAssign={handleDeliveryAssignment}
                                                    onPaymentEdit={() => handlePaymentClick(order)}
                                                    onWhatsAppDelivery={() => handleSendWhatsAppToDelivery(order)}
                                                    onWhatsAppStore={() => handleSendWhatsAppToStore(order)}
                                                    onPrint={(silent?: boolean) => handlePrint(order, silent)}
                                                    onDeliveryStatusClick={(o: any) => {
                                                        setSelectedOrderForStatusModal(o)
                                                        setDeliveryStatusModalOpen(true)
                                                    }}
                                                    onEdit={() => {
                                                        setSelectedOrderForEdit(order)
                                                        setManualSidebarMode('edit')
                                                        setManualOrderSidebarOpen(true)
                                                    }}
                                                    onDelete={() => handleDeleteOrder(order.id)}
                                                    onCustomerClick={() => {
                                                        setSelectedOrderForCustomerContact(order)
                                                        setCustomerContactModalOpen(true)
                                                    }}
                                                    sectionKey={sectionKey}
                                                    businessPhone={business?.phone}
                                                    canChangeDelivery={canChangeDelivery}
                                                    canDeleteOrders={canDeleteOrders}
                                                    deliveryTimeMinutes={deliveryTimeMinutes}
                                                    autoPrintOnConfirm={autoPrintOnConfirm}
                                                    clientsWithNotes={clientsWithNotes}
                                                    businessName={bizName}
                                                />
                                            )
                                        })}
                                    </div>
                                </div>
                            )
                        })}
                    </CollapsibleSection>
                );
            })}
        </>
    );
}
