'use client'

import React from 'react'
import { Order } from '@/types'
import { sendWhatsAppToCustomer } from '@/components/WhatsAppUtils'

export function CustomerContactModal({
    isOpen,
    onClose,
    order
}: {
    isOpen: boolean,
    onClose: () => void,
    order: Order | null
}) {
    if (!isOpen || !order) return null

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
                        <div>
                            <h3 className="text-xl font-bold text-gray-900">Contactar Cliente</h3>
                            <p className="text-sm text-gray-500 mt-1">{order.customer?.name}</p>
                        </div>
                        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg text-gray-400">
                            <i className="bi bi-x-lg"></i>
                        </button>
                    </div>

                    <div className="space-y-3">
                        <button
                            onClick={() => {
                                sendWhatsAppToCustomer(order)
                                onClose()
                            }}
                            className="w-full flex items-center justify-center gap-3 py-4 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-200"
                        >
                            <i className="bi bi-whatsapp text-xl"></i>
                            Enviar WhatsApp
                        </button>

                        <a
                            href={`tel:${order.customer?.phone}`}
                            onClick={onClose}
                            className="w-full flex items-center justify-center gap-3 py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
                        >
                            <i className="bi bi-telephone-fill text-xl"></i>
                            Llamar por teléfono
                        </a>
                    </div>
                </div>
            </div>
        </div>
    )
}
