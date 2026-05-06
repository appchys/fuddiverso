'use client'

import React, { useMemo, useState } from 'react'
import { Business, Order } from '@/types'

type PaymentStatus = 'validating' | 'pending' | 'paid' | 'rejected'

interface TransferReviewPanelProps {
    orders: Order[]
    onPaymentEdit: (order: Order) => void
    onPaymentValidate?: (order: Order) => void | Promise<void>
    validatingOrderId?: string | null
    businesses?: Business[]
}

const paymentStatusConfig: Record<PaymentStatus, {
    label: string
    description: string
    icon: string
    badgeClass: string
    borderClass: string
}> = {
    validating: {
        label: 'Validando',
        description: 'Transferencias que necesitan revisión',
        icon: 'fact_check',
        badgeClass: 'bg-amber-100 text-amber-700',
        borderClass: 'border-amber-200'
    },
    pending: {
        label: 'Pendientes',
        description: 'Aún no marcadas como recibidas',
        icon: 'schedule',
        badgeClass: 'bg-gray-100 text-gray-700',
        borderClass: 'border-gray-200'
    },
    paid: {
        label: 'Confirmadas',
        description: 'Pagos verificados',
        icon: 'verified',
        badgeClass: 'bg-emerald-100 text-emerald-700',
        borderClass: 'border-emerald-200'
    },
    rejected: {
        label: 'Rechazadas',
        description: 'Pagos marcados como rechazados',
        icon: 'block',
        badgeClass: 'bg-red-100 text-red-700',
        borderClass: 'border-red-200'
    }
}

const statusOrder: PaymentStatus[] = ['validating', 'pending', 'paid', 'rejected']

const toSafeDate = (value: any): Date => {
    if (!value) return new Date(0)
    if (value instanceof Date) return value
    if (typeof value?.toDate === 'function') return value.toDate()
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000)
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? new Date(0) : date
}

const getOrderDate = (order: Order) => {
    if (order.timing?.type === 'scheduled' && order.timing.scheduledDate) {
        const date = toSafeDate(order.timing.scheduledDate)
        if (order.timing.scheduledTime) {
            const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number)
            if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
                date.setHours(hours, minutes, 0, 0)
            }
        }
        return date
    }

    return toSafeDate(order.createdAt)
}

const formatDate = (date: Date) => {
    return date.toLocaleString('es-EC', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    })
}

const getPaymentStatus = (order: Order): PaymentStatus => {
    const status = order.payment?.paymentStatus
    if (status === 'validating' || status === 'paid' || status === 'rejected') return status
    return 'pending'
}

const getTransferAmount = (order: Order) => {
    if (order.payment?.method === 'mixed') {
        return order.payment.transferAmount || 0
    }

    return order.total || 0
}

export default function TransferReviewPanel({
    orders,
    onPaymentEdit,
    onPaymentValidate,
    validatingOrderId = null,
    businesses = []
}: TransferReviewPanelProps) {
    const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null)

    const transferOrders = useMemo(() => {
        return orders
            .filter(order => {
                if (order.status === 'cancelled') return false
                if (order.payment?.method === 'transfer') return true
                return order.payment?.method === 'mixed' && (order.payment.transferAmount || 0) > 0
            })
            .sort((a, b) => getOrderDate(b).getTime() - getOrderDate(a).getTime())
    }, [orders])

    const groupedOrders = useMemo(() => {
        return statusOrder.map(status => {
            const statusOrders = transferOrders.filter(order => getPaymentStatus(order) === status)
            const total = statusOrders.reduce((sum, order) => sum + getTransferAmount(order), 0)
            return { status, orders: statusOrders, total }
        })
    }, [transferOrders])

    const totalTransferAmount = transferOrders.reduce((sum, order) => sum + getTransferAmount(order), 0)
    const validatingCount = groupedOrders.find(group => group.status === 'validating')?.orders.length || 0
    const pendingCount = groupedOrders.find(group => group.status === 'pending')?.orders.length || 0
    const receiptOrder = receiptOrderId
        ? transferOrders.find(order => order.id === receiptOrderId) || null
        : null
    const receiptOrderIsPaid = receiptOrder ? getPaymentStatus(receiptOrder) === 'paid' : false
    const receiptOrderIsValidating = receiptOrder ? validatingOrderId === receiptOrder.id : false

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-black text-gray-900">Revisar transferencias</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Pedidos pagados por transferencia, agrupados por estado y ordenados por fecha.
                    </p>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
                    <div className="bg-white border border-gray-100 rounded-xl p-3">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total</p>
                        <p className="text-lg font-black text-gray-900">{transferOrders.length}</p>
                    </div>
                    <div className="bg-white border border-amber-100 rounded-xl p-3">
                        <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Por revisar</p>
                        <p className="text-lg font-black text-amber-700">{validatingCount + pendingCount}</p>
                    </div>
                    <div className="bg-white border border-emerald-100 rounded-xl p-3">
                        <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Monto</p>
                        <p className="text-lg font-black text-emerald-700">${totalTransferAmount.toFixed(2)}</p>
                    </div>
                </div>
            </div>

            {transferOrders.length === 0 ? (
                <div className="bg-white border border-dashed border-gray-200 rounded-xl p-8 text-center">
                    <span className="material-symbols-rounded text-4xl text-gray-300">account_balance</span>
                    <p className="mt-2 font-bold text-gray-700">No hay transferencias para revisar</p>
                    <p className="text-sm text-gray-500">Cuando existan pedidos con transferencia aparecerán aquí.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {groupedOrders.map(group => {
                        const config = paymentStatusConfig[group.status]

                        return (
                            <section key={group.status} className={`bg-white border ${config.borderClass} rounded-xl overflow-hidden shadow-sm`}>
                                <div className="px-4 py-3 bg-gray-50/80 border-b border-gray-100 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="material-symbols-rounded text-gray-500">{config.icon}</span>
                                        <div className="min-w-0">
                                            <h2 className="font-black text-gray-900">{config.label}</h2>
                                            <p className="text-xs text-gray-500 truncate">{config.description}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className={`px-2.5 py-1 rounded-full text-xs font-black ${config.badgeClass}`}>
                                            {group.orders.length}
                                        </span>
                                        <span className="hidden sm:inline text-sm font-black text-gray-700">
                                            ${group.total.toFixed(2)}
                                        </span>
                                    </div>
                                </div>

                                {group.orders.length === 0 ? (
                                    <div className="px-4 py-6 text-sm text-gray-400 text-center">
                                        Sin pedidos en este estado.
                                    </div>
                                ) : (
                                    <div className="divide-y divide-gray-100">
                                        {group.orders.map(order => {
                                            const orderDate = getOrderDate(order)
                                            const transferAmount = getTransferAmount(order)
                                            const isMixed = order.payment?.method === 'mixed'
                                            const business = businesses.find(item => item.id === order.businessId)

                                            const isPaid = getPaymentStatus(order) === 'paid'
                                            const isValidating = validatingOrderId === order.id

                                            return (
                                                <div
                                                    key={order.id}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => onPaymentEdit(order)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault()
                                                            onPaymentEdit(order)
                                                        }
                                                    }}
                                                    className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                                                            <span className="material-symbols-rounded text-xl">account_balance</span>
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <p className="font-bold text-gray-900 truncate">
                                                                    {order.customer?.name || 'Cliente sin nombre'}
                                                                </p>
                                                                {isMixed && (
                                                                    <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-[10px] font-black uppercase tracking-wider">
                                                                        Mixto
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="text-xs text-gray-500">
                                                                {formatDate(orderDate)} · Pedido #{order.id.slice(0, 6)}
                                                            </p>
                                                            {business && (
                                                                <p className="text-xs text-gray-400 mt-0.5 truncate">
                                                                    {business.name}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <p className="font-black text-gray-900">${transferAmount.toFixed(2)}</p>
                                                            <div className="mt-1 flex flex-col items-end gap-1">
                                                                <button
                                                                    type="button"
                                                                    disabled={isPaid || isValidating || !onPaymentValidate}
                                                                    onClick={(event) => {
                                                                        event.stopPropagation()
                                                                        onPaymentValidate?.(order)
                                                                    }}
                                                                    className={`px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider transition-colors ${
                                                                        isPaid
                                                                            ? 'bg-emerald-50 text-emerald-600 cursor-default'
                                                                            : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed'
                                                                    }`}
                                                                >
                                                                    {isPaid ? 'Validada' : isValidating ? 'Validando...' : 'Validar'}
                                                                </button>
                                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                                                    Revisar
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {order.payment?.receiptImageUrl && (
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation()
                                                                setReceiptOrderId(order.id)
                                                            }}
                                                            className="mt-3 flex w-full items-center gap-3 rounded-lg border border-blue-100 bg-blue-50/60 p-2 text-left hover:bg-blue-50 transition-colors"
                                                        >
                                                            <img
                                                                src={order.payment.receiptImageUrl}
                                                                alt={`Comprobante del pedido ${order.id.slice(0, 6)}`}
                                                                className="h-14 w-14 rounded-md object-cover border border-white shadow-sm"
                                                            />
                                                            <div className="min-w-0 flex-1">
                                                                <p className="text-xs font-black text-blue-700 uppercase tracking-wider">
                                                                    Comprobante
                                                                </p>
                                                                <p className="text-xs text-blue-600 truncate">
                                                                    Toca para ampliar y validar
                                                                </p>
                                                            </div>
                                                            <span className="material-symbols-rounded text-blue-500">open_in_full</span>
                                                        </button>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </section>
                        )
                    })}
                </div>
            )}

            {receiptOrder?.payment?.receiptImageUrl && (
                <div className="fixed inset-0 z-[70] bg-black/70 p-4 flex items-center justify-center">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
                        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <h3 className="font-black text-gray-900">Comprobante</h3>
                                <p className="text-xs text-gray-500 truncate">
                                    {receiptOrder.customer?.name || 'Cliente sin nombre'} · Pedido #{receiptOrder.id.slice(0, 6)}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setReceiptOrderId(null)}
                                className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500"
                            >
                                <span className="material-symbols-rounded">close</span>
                            </button>
                        </div>

                        <div className="flex-1 min-h-0 bg-gray-100 p-3 flex items-center justify-center">
                            <img
                                src={receiptOrder.payment.receiptImageUrl}
                                alt={`Comprobante del pedido ${receiptOrder.id.slice(0, 6)}`}
                                className="max-w-full max-h-[68vh] object-contain rounded-lg shadow-sm"
                            />
                        </div>

                        <div className="p-4 border-t border-gray-100 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm font-black text-gray-900">
                                    ${getTransferAmount(receiptOrder).toFixed(2)}
                                </p>
                                <p className="text-xs text-gray-500">
                                    {formatDate(getOrderDate(receiptOrder))}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setReceiptOrderId(null)
                                        onPaymentEdit(receiptOrder)
                                    }}
                                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                >
                                    Editar
                                </button>
                                <button
                                    type="button"
                                    disabled={receiptOrderIsPaid || receiptOrderIsValidating || !onPaymentValidate}
                                    onClick={() => onPaymentValidate?.(receiptOrder)}
                                    className={`px-4 py-2 rounded-lg text-sm font-black transition-colors ${
                                        receiptOrderIsPaid
                                            ? 'bg-emerald-50 text-emerald-700'
                                            : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed'
                                    }`}
                                >
                                    {receiptOrderIsPaid ? 'Validada' : receiptOrderIsValidating ? 'Validando...' : 'Validar'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
