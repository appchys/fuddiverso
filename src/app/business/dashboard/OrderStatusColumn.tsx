'use client'

import React from 'react'
import { Order, Delivery, Business } from '@/types'
import { getStatusText } from './dashboard-utils'
import { CollapsibleSection } from './CollapsibleSection'
import { OrderCard } from './OrderCard'

interface OrderStatusColumnProps {
    statuses: any[]
    orders: Order[]
    availableDeliveries: Delivery[]
    handleStatusChange: (id: string, status: Order['status'], reason?: string) => void
    handleDeliveryAssignment: (id: string, deliveryId: string) => void
    handlePaymentClick: (order: Order) => void
    handleSendWhatsAppToDelivery: (order: Order) => void
    handlePrint: (order: Order, silent?: boolean) => void
    handleDeliveryStatusClick: (order: Order) => void
    handleEditOrder: (order: Order) => void
    handleDeleteOrder: (id: string) => void
    handleCustomerClick: (order: Order) => void
    business: Business | null
    canChangeDelivery: boolean
    canDeleteOrders: boolean
    deliveryTimeMinutes: number
    autoPrintOnConfirm: boolean
    clientsWithNotes: Record<string, string>
}

export function OrderStatusColumn({
    statuses,
    orders,
    availableDeliveries,
    handleStatusChange,
    handleDeliveryAssignment,
    handlePaymentClick,
    handleSendWhatsAppToDelivery,
    handlePrint,
    handleDeliveryStatusClick,
    handleEditOrder,
    handleDeleteOrder,
    handleCustomerClick,
    business,
    canChangeDelivery,
    canDeleteOrders,
    deliveryTimeMinutes,
    autoPrintOnConfirm,
    clientsWithNotes
}: OrderStatusColumnProps) {
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

                return (
                    <CollapsibleSection
                        key={sectionKey}
                        title={sectionTitle}
                        count={sectionCount}
                        status={sectionStatusColor}
                        defaultExpanded={sectionDefaultExpanded}
                    >
                        {statusOrders.map((order: any) => (
                            <OrderCard
                                key={order.id}
                                order={order}
                                availableDeliveries={availableDeliveries}
                                onStatusChange={handleStatusChange}
                                onDeliveryAssign={handleDeliveryAssignment}
                                onPaymentEdit={handlePaymentClick}
                                onWhatsAppDelivery={handleSendWhatsAppToDelivery}
                                onPrint={handlePrint}
                                onDeliveryStatusClick={handleDeliveryStatusClick}
                                onEdit={handleEditOrder}
                                onDelete={handleDeleteOrder}
                                onCustomerClick={handleCustomerClick}
                                sectionKey={sectionKey}
                                businessPhone={business?.phone}
                                canChangeDelivery={canChangeDelivery}
                                canDeleteOrders={canDeleteOrders}
                                deliveryTimeMinutes={deliveryTimeMinutes}
                                autoPrintOnConfirm={autoPrintOnConfirm}
                                customerNote={order.customer?.phone ? clientsWithNotes[order.customer.phone] : undefined}
                             />
                        ))}
                    </CollapsibleSection>
                );
            })}
        </>
    );
}
