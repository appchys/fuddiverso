'use client'

import React, { useState, useEffect } from 'react'
import { Order, PaymentInfo } from '@/types'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'

interface PaymentManagementModalsProps {
    isOpen: boolean
    onClose: () => void
    order: Order | null
    onOrderUpdated: (updatedOrder: Order) => void
}

interface EditPaymentData extends Pick<PaymentInfo, 'method' | 'paymentStatus'> {
    cashAmount: number;
    transferAmount: number;
}

export default function PaymentManagementModals({
    isOpen,
    onClose,
    order,
    onOrderUpdated
}: PaymentManagementModalsProps) {
    const [editPaymentData, setEditPaymentData] = useState<EditPaymentData>({
        method: 'cash',
        cashAmount: 0,
        transferAmount: 0,
        paymentStatus: 'pending'
    })

    const [showReceiptPreviewModal, setShowReceiptPreviewModal] = useState(false)

    // Initialize state when order changes
    useEffect(() => {
        if (order && isOpen) {
            setEditPaymentData({
                method: order.payment?.method || 'cash',
                cashAmount: (order.payment as any)?.cashAmount || 0,
                transferAmount: (order.payment as any)?.transferAmount || 0,
                paymentStatus: order.payment?.paymentStatus || (order.payment?.method === 'transfer' ? 'paid' : 'pending')
            })
        }
    }, [order, isOpen])

    const handleSavePaymentEdit = async () => {
        if (!order) return

        try {
            let paymentUpdate: any = {
                method: editPaymentData.method,
                paymentStatus: editPaymentData.paymentStatus || 'pending'
            }

            if (editPaymentData.method === 'mixed') {
                paymentUpdate.cashAmount = editPaymentData.cashAmount
                paymentUpdate.transferAmount = editPaymentData.transferAmount
            }

            const orderRef = doc(db, 'orders', order.id)
            await updateDoc(orderRef, {
                payment: {
                    ...order.payment,
                    ...paymentUpdate
                }
            })

            // Update parent state
            onOrderUpdated({
                ...order,
                payment: {
                    ...order.payment!,
                    ...paymentUpdate
                }
            })

            onClose()
        } catch (error) {
            console.error('Error updating payment:', error)
            alert('Error al actualizar el pago')
        }
    }

    const handleValidatePayment = async () => {
        if (!order) return

        try {
            let paymentUpdate: any = {
                method: editPaymentData.method,
                paymentStatus: 'paid' as const
            }

            if (editPaymentData.method === 'mixed') {
                paymentUpdate.cashAmount = editPaymentData.cashAmount
                paymentUpdate.transferAmount = editPaymentData.transferAmount
            }

            const updatedPayment = {
                ...order.payment,
                ...paymentUpdate
            }

            const orderRef = doc(db, 'orders', order.id)
            await updateDoc(orderRef, {
                payment: updatedPayment
            })

            onOrderUpdated({ ...order, payment: updatedPayment })

            setShowReceiptPreviewModal(false)
            onClose()
        } catch (error) {
            console.error('Error validating payment:', error)
            alert('Error al validar el pago')
        }
    }

    const handleRejectPayment = async () => {
        if (!order) return

        try {
            const orderRef = doc(db, 'orders', order.id)
            await updateDoc(orderRef, {
                'payment.paymentStatus': 'rejected' as const
            })

            const updatedPayment = {
                ...order.payment!,
                paymentStatus: 'rejected' as const
            }

            onOrderUpdated({ ...order, payment: updatedPayment })

            // Update local state to reflect rejection
            setEditPaymentData(prev => ({
                ...prev,
                paymentStatus: 'rejected'
            }))

            setShowReceiptPreviewModal(false)
        } catch (error) {
            alert('Error al rechazar el pago')
        }
    }

    if (!isOpen || !order) return null

    return (
        <>
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl max-w-md w-full">
                    <div className="p-6">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-gray-900">
                                <i className="bi bi-credit-card me-2"></i>
                                Editar Método de Pago
                            </h2>
                            <button
                                onClick={onClose}
                                className="text-gray-500 hover:text-gray-700 text-2xl"
                            >
                                ×
                            </button>
                        </div>

                        {/* Order Info */}
                        <div className="mb-6 p-4 bg-gray-50 rounded-lg flex justify-between items-start">
                            <div>
                                <p className="text-sm text-gray-600">Pedido de:</p>
                                <p className="text-lg font-semibold text-gray-900">
                                    {order.customer?.name || 'Cliente sin nombre'}
                                </p>
                                <p className="text-sm text-gray-600 mt-1">
                                    Total: <span className="font-bold text-emerald-600">
                                        ${(order.total || 0).toFixed(2)}
                                    </span>
                                </p>
                            </div>

                            {/* Receipt Preview Button */}
                            {order.payment?.receiptImageUrl && (
                                <div className="ml-4">
                                    <p className="text-xs text-gray-500 mb-1 text-center">Comprobante</p>
                                    <button
                                        type="button"
                                        onClick={() => setShowReceiptPreviewModal(true)}
                                        className="block relative group"
                                        title="Ver comprobante completo"
                                    >
                                        <img
                                            src={order.payment.receiptImageUrl}
                                            alt="Comprobante de pago"
                                            className="w-24 h-24 object-cover rounded-lg border border-gray-200 shadow-sm hover:opacity-90 transition-opacity"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-all rounded-lg">
                                            <i className="bi bi-zoom-in text-white opacity-0 group-hover:opacity-100 drop-shadow-md"></i>
                                        </div>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Payment Method Selection */}
                        <div className="space-y-4 mb-6">
                            <label className="block text-sm font-medium text-gray-700">
                                Método de Pago
                            </label>

                            <div className="space-y-3">
                                <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                                    <input
                                        type="radio"
                                        name="paymentMethod"
                                        value="cash"
                                        checked={editPaymentData.method === 'cash'}
                                        onChange={(e) => setEditPaymentData({
                                            ...editPaymentData,
                                            method: e.target.value as 'cash',
                                            cashAmount: 0,
                                            transferAmount: 0,
                                            paymentStatus: 'pending'
                                        })}
                                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
                                    />
                                    <span className="ml-3 text-gray-700">
                                        <i className="bi bi-cash me-2 text-green-600"></i>
                                        Efectivo
                                    </span>
                                </label>

                                <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                                    <input
                                        type="radio"
                                        name="paymentMethod"
                                        value="transfer"
                                        checked={editPaymentData.method === 'transfer'}
                                        onChange={(e) => setEditPaymentData({
                                            ...editPaymentData,
                                            method: e.target.value as 'transfer',
                                            cashAmount: 0,
                                            transferAmount: 0,
                                            paymentStatus: 'paid'
                                        })}
                                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
                                    />
                                    <span className="ml-3 text-gray-700">
                                        <i className="bi bi-credit-card me-2 text-blue-600"></i>
                                        Transferencia
                                    </span>
                                </label>

                                <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                                    <input
                                        type="radio"
                                        name="paymentMethod"
                                        value="mixed"
                                        checked={editPaymentData.method === 'mixed'}
                                        onChange={(e) => setEditPaymentData({
                                            ...editPaymentData,
                                            method: e.target.value as 'mixed',
                                            cashAmount: 0,
                                            transferAmount: 0,
                                            paymentStatus: 'pending'
                                        })}
                                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
                                    />
                                    <span className="ml-3 text-gray-700">
                                        <i className="bi bi-cash-coin me-2 text-yellow-600"></i>
                                        Mixto (Efectivo + Transferencia)
                                    </span>
                                </label>
                            </div>

                            {/* Payment Status Selection */}
                            <div className="mt-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Estado del Pago
                                </label>
                                <select
                                    value={editPaymentData.paymentStatus}
                                    onChange={(e) => setEditPaymentData({
                                        ...editPaymentData,
                                        paymentStatus: e.target.value as 'pending' | 'validating' | 'paid'
                                    })}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm bg-white"
                                >
                                    <option value="pending">Pendiente</option>
                                    <option value="validating">Validando</option>
                                    <option value="paid">Pagado</option>
                                </select>
                            </div>

                            {/* Mixed Payment Amounts */}
                            {editPaymentData.method === 'mixed' && (
                                <div className="mt-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                                    <h4 className="text-sm font-medium text-gray-900 mb-3">
                                        <i className="bi bi-calculator me-1"></i>
                                        Distribución del Pago
                                    </h4>
                                    <div className="grid grid-cols-1 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 mb-1">
                                                Efectivo
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                max={order.total || 0}
                                                step="0.01"
                                                value={editPaymentData.cashAmount}
                                                onChange={(e) => {
                                                    const cashAmount = parseFloat(e.target.value) || 0
                                                    const transferAmount = (order.total || 0) - cashAmount
                                                    setEditPaymentData({
                                                        ...editPaymentData,
                                                        cashAmount,
                                                        transferAmount: Math.max(0, transferAmount)
                                                    })
                                                }}
                                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-red-500 focus:border-red-500"
                                                placeholder="0.00"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 mb-1">
                                                Transferencia
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                max={order.total || 0}
                                                step="0.01"
                                                value={editPaymentData.transferAmount}
                                                onChange={(e) => {
                                                    const transferAmount = parseFloat(e.target.value) || 0
                                                    const cashAmount = (order.total || 0) - transferAmount
                                                    setEditPaymentData({
                                                        ...editPaymentData,
                                                        transferAmount,
                                                        cashAmount: Math.max(0, cashAmount)
                                                    })
                                                }}
                                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-red-500 focus:border-red-500"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                    <div className="mt-2 text-sm text-gray-600">
                                        Total: ${((editPaymentData.cashAmount || 0) + (editPaymentData.transferAmount || 0)).toFixed(2)} / ${(order.total || 0).toFixed(2)}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex space-x-3">
                            <button
                                onClick={handleSavePaymentEdit}
                                disabled={editPaymentData.method === 'mixed' &&
                                    ((editPaymentData.cashAmount || 0) + (editPaymentData.transferAmount || 0)) !== (order.total || 0)
                                }
                                className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                                <i className="bi bi-check-lg me-2"></i>
                                Guardar Cambios
                            </button>
                            <button
                                onClick={onClose}
                                className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div >
                </div >
            </div >

            {/* Receipt Preview Modal */}
            {showReceiptPreviewModal && order.payment?.receiptImageUrl && (
                <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[70] p-4">
                    <div className="relative max-w-4xl w-full h-full flex flex-col items-center justify-center">
                        {/* Close Button */}
                        <button
                            onClick={() => setShowReceiptPreviewModal(false)}
                            className="absolute -top-1 right-0 text-white text-4xl p-4 hover:text-gray-300 transition-colors z-10"
                        >
                            ×
                        </button>

                        <div className="w-full h-full flex flex-col bg-white rounded-2xl overflow-hidden shadow-2xl">
                            {/* Header Info */}
                            <div className="p-4 border-b flex items-center justify-between bg-gray-50">
                                <div>
                                    <h3 className="font-bold text-gray-900">Comprobante de Pago</h3>
                                    <p className="text-sm text-gray-600">
                                        Cliente: {order.customer?.name} - Total: ${(order.total || 0).toFixed(2)}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleRejectPayment}
                                        className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-bold text-sm flex items-center gap-2"
                                    >
                                        <i className="bi bi-x-circle"></i>
                                        Rechazar
                                    </button>
                                    <button
                                        onClick={handleValidatePayment}
                                        className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-200"
                                    >
                                        <i className="bi bi-check-circle"></i>
                                        Validar
                                    </button>
                                </div>
                            </div>

                            {/* Image */}
                            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-gray-200">
                                <img
                                    src={order.payment.receiptImageUrl}
                                    alt="Comprobante completo"
                                    className="max-w-full max-h-full object-contain shadow-lg"
                                />
                            </div>

                            {/* Footer */}
                            <div className="p-3 bg-gray-50 text-center border-t">
                                <p className="text-xs text-gray-500 italic">
                                    Al validar, el estado del pago cambiará automáticamente a "Pagado"
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
