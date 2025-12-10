'use client'

import { useState } from 'react'
import Link from 'next/link'

interface CartSidebarProps {
    isOpen: boolean
    onClose: () => void
    cart: any[]
    business: any
    removeFromCart: (productId: string) => void
    updateQuantity: (productId: string, quantity: number) => void
}

export default function CartSidebar({
    isOpen,
    onClose,
    cart,
    business,
    removeFromCart,
    updateQuantity
}: CartSidebarProps) {
    if (!isOpen) return null

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0)

    return (
        <div className="fixed inset-0 z-50 overflow-hidden">
            <div className="absolute inset-0 bg-black bg-opacity-50 transition-all duration-300" onClick={onClose} />
            <div className="absolute right-0 top-0 h-full w-full sm:w-96 bg-white shadow-2xl">
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="p-4 bg-gradient-to-r from-red-500 to-red-600 text-white">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-semibold">Tu Pedido</h3>
                                <p className="text-red-100 text-sm">{business?.name}</p>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-red-600 rounded-lg transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        {cart.length > 0 && (
                            <div className="mt-2 text-sm text-red-100">
                                {cartItemsCount} {cartItemsCount === 1 ? 'producto' : 'productos'}
                            </div>
                        )}
                    </div>

                    {/* Cart Content */}
                    <div className="flex-1 overflow-y-auto px-4 pt-4">
                        {cart.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4">
                                <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                                    <i className="bi bi-cart text-4xl text-gray-400"></i>
                                </div>
                                <h4 className="text-lg font-medium text-gray-900 mb-2">Tu carrito está vacío</h4>
                                <p className="text-gray-500 text-sm">Agrega algunos productos para comenzar</p>
                            </div>
                        ) : (
                            <div className="space-y-4 pb-4">
                                {(() => {
                                    // Agrupar items por producto
                                    const grouped: Record<string, any[]> = {}

                                    cart.forEach(item => {
                                        if (item.esPremio) {
                                            if (!grouped['___premio___']) grouped['___premio___'] = []
                                            grouped['___premio___'].push(item)
                                            return
                                        }
                                        const key = item.productName || item.name
                                        if (!grouped[key]) grouped[key] = []
                                        grouped[key].push(item)
                                    })

                                    return Object.entries(grouped)
                                        .sort(([a]) => (a === '___premio___' ? 1 : -1))
                                        .map(([productName, items], groupIndex) => {
                                            const isPremio = productName === '___premio___'
                                            const firstItem = items[0]

                                            return (
                                                <div key={productName} className={groupIndex > 0 ? 'pt-4 border-t border-gray-200' : ''}>
                                                    {/* Header del producto (solo si no es premio) */}
                                                    {!isPremio && (
                                                        <div className="flex items-center gap-2 mb-2 px-2">
                                                            <div className="w-8 h-8 rounded-md overflow-hidden bg-gray-100 flex-shrink-0">
                                                                <img
                                                                    src={firstItem.image || business?.image}
                                                                    alt={productName}
                                                                    className="w-full h-full object-cover"
                                                                    onError={(e) => {
                                                                        const target = e.target as HTMLImageElement
                                                                        if (target.src !== business?.image) target.src = business?.image || ''
                                                                    }}
                                                                />
                                                            </div>
                                                            <h4 className="font-semibold text-sm text-gray-900">{productName}</h4>
                                                        </div>
                                                    )}

                                                    {/* Items del producto */}
                                                    <div className="space-y-2">
                                                        {items.map((item) => (
                                                            <div
                                                                key={item.id}
                                                                className={`flex items-center gap-2 p-3 rounded-lg transition-all ${item.esPremio
                                                                    ? 'bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-300'
                                                                    : 'bg-white border border-gray-200 hover:shadow-sm'
                                                                    }`}
                                                            >
                                                                {/* Nombre de variante o producto */}
                                                                <div className="flex-1 min-w-0">
                                                                    <p className={`font-medium text-sm leading-tight line-clamp-2 ${item.esPremio ? 'text-amber-900' : 'text-gray-900'
                                                                        }`}>
                                                                        {item.esPremio ? item.name : (item.variantName || item.name)}
                                                                    </p>
                                                                    {item.esPremio && (
                                                                        <span className="inline-block mt-1 text-xs bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full font-bold">
                                                                            🎁 Premio
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                {/* Cantidad */}
                                                                {!item.esPremio ? (
                                                                    <div className="flex items-center border rounded-lg overflow-hidden bg-white flex-shrink-0">
                                                                        <button
                                                                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                                                            className="px-1.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                                                                        >
                                                                            −
                                                                        </button>
                                                                        <div className="px-2 py-1 min-w-[32px] text-center font-medium text-sm">
                                                                            {item.quantity}
                                                                        </div>
                                                                        <button
                                                                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                                                            className="px-1.5 py-1 bg-red-500 text-white hover:bg-red-600 transition-colors"
                                                                        >
                                                                            +
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="px-2 py-1 text-sm font-medium text-amber-900 flex-shrink-0">
                                                                        x1
                                                                    </div>
                                                                )}

                                                                {/* Subtotal */}
                                                                <div className={`font-bold text-sm min-w-[50px] text-right flex-shrink-0 ${item.price === 0 ? 'text-green-600' : 'text-gray-900'
                                                                    }`}>
                                                                    {item.price === 0 ? 'GRATIS' : `$${(item.price * item.quantity).toFixed(2)}`}
                                                                </div>

                                                                {/* Eliminar */}
                                                                <button
                                                                    onClick={() => removeFromCart(item.id)}
                                                                    className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition flex-shrink-0"
                                                                    title="Eliminar"
                                                                >
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )
                                        })
                                })()}
                            </div>
                        )}
                    </div>

                    {/* Footer con resumen y botón de checkout */}
                    {cart.length > 0 && (
                        <div className="border-t bg-white p-4 space-y-4">
                            {/* Resumen del pedido */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Subtotal ({cartItemsCount} productos)</span>
                                    <span className="font-medium">${cartTotal.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Envío</span>
                                    <span className="text-gray-500">A calcular</span>
                                </div>
                                <div className="border-t pt-2">
                                    <div className="flex justify-between items-center">
                                        <span className="font-semibold text-gray-900">Total</span>
                                        <span className="font-bold text-xl text-red-600">${cartTotal.toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Botón de checkout */}
                            {cartTotal > 0 ? (
                                <Link
                                    href={`/checkout?businessId=${business!.id}`}
                                    className="w-full bg-gradient-to-r from-red-500 to-red-600 text-white py-4 rounded-xl hover:from-red-600 hover:to-red-700 transition-all duration-200 flex items-center justify-center font-semibold text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                                    onClick={onClose}
                                >
                                    <i className="bi bi-cart mr-2 text-xl"></i>
                                    Continuar con el pedido
                                </Link>
                            ) : (
                                <button
                                    onClick={onClose}
                                    className="w-full bg-gradient-to-r from-gray-500 to-gray-600 text-white py-4 rounded-xl hover:from-gray-600 hover:to-gray-700 transition-all duration-200 flex items-center justify-center font-semibold text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                                >
                                    <i className="bi bi-plus-circle mr-2 text-xl"></i>
                                    Agrega más productos
                                </button>
                            )}

                            {/* Texto informativo */}
                            <p className="text-xs text-gray-500 text-center">
                                Los costos de envío se calcularán en el siguiente paso
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
