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
    setSelectedOrderForStatusModal: (order: Order | null) => void
    setDeliveryStatusModalOpen: (open: boolean) => void
    setSelectedOrderForEdit: (order: Order | null) => void
    setManualSidebarMode: (mode: 'create' | 'edit') => void
    setManualOrderSidebarOpen: (open: boolean) => void
    handleDeleteOrder: (id: string) => void
    setSelectedOrderForCustomerContact: (order: Order | null) => void
    setCustomerContactModalOpen: (open: boolean) => void
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
                                onPaymentEdit={() => handlePaymentClick(order)}
                                onWhatsAppDelivery={() => handleSendWhatsAppToDelivery(order)}
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
                             />
                        ))}
                    </CollapsibleSection>
                );
            })}
        </>
    );
}
