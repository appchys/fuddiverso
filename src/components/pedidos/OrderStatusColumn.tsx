'use client'

import React, { useState } from 'react'
import { Order, Delivery, Business } from '@/types'
import { OrderCard, getStatusText } from './OrderCard'

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
                <div className="p-4 space-y-3 bg-gray-100 animate-in slide-in-from-top-2 duration-200">
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

                return (
                    <CollapsibleSection
                        key={sectionKey}
                        title={sectionTitle}
                        count={sectionCount}
                        status={sectionStatusColor}
                        defaultExpanded={sectionDefaultExpanded}
                    >
                        {statusOrders.map((order: any) => {
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
                    </CollapsibleSection>
                );
            })}
        </>
    );
}
