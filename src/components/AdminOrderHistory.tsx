'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, getDocs, limit, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Order, Business } from '@/types'

interface AdminOrderHistoryProps {
    businesses: Business[]
    onOrderClick: (orderId: string) => void
    getStatusTextList: (status: string) => string
}

export default function AdminOrderHistory({
    businesses,
    onOrderClick,
    getStatusTextList
}: AdminOrderHistoryProps) {
    const [orders, setOrders] = useState<Order[]>([])
    const [loading, setLoading] = useState(true)
    const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set())

    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const ordersRef = collection(db, 'orders')
                // El historial trae pedidos de todas las tiendas, ordenados por fecha de creación
                const q = query(
                    ordersRef,
                    orderBy('createdAt', 'desc'),
                    limit(500) // Límite razonable para rendimiento inicial
                )
                const snapshot = await getDocs(q)
                const ordersData = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as Order[]

                setOrders(ordersData)
            } catch (error) {
                console.error('Error fetching historical orders:', error)
            } finally {
                setLoading(false)
            }
        }

        fetchOrders()
    }, [])

    // Función para obtener la fecha de un pedido de manera robusta
    const getOrderDate = (order: Order) => {
        if (order.createdAt instanceof Timestamp) return order.createdAt.toDate()
        if (order.createdAt && typeof order.createdAt === 'object' && 'seconds' in (order.createdAt as any)) {
            return new Date((order.createdAt as any).seconds * 1000)
        }
        return order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt || Date.now())
    }

    // Agrupar pedidos por fecha local de Ecuador
    const groupedOrders = useMemo(() => {
        const grouped: Record<string, Order[]> = {}

        orders.forEach(order => {
            const date = getOrderDate(order)
            const dateKey = date.toLocaleDateString('es-EC', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })

            if (!grouped[dateKey]) {
                grouped[dateKey] = []
            }
            grouped[dateKey].push(order)
        })

        // Convertir a array y ordenar las fechas descendente
        return Object.entries(grouped).sort((a, b) => {
            const dateA = getOrderDate(grouped[a[0]][0])
            const dateB = getOrderDate(grouped[b[0]][0])
            return dateB.getTime() - dateA.getTime()
        })
    }, [orders])

    const toggleDate = (date: string) => {
        const newCollapsed = new Set(collapsedDates)
        if (newCollapsed.has(date)) {
            newCollapsed.delete(date)
        } else {
            newCollapsed.add(date)
        }
        setCollapsedDates(newCollapsed)
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 bg-white rounded-2xl border border-gray-100 shadow-sm animate-pulse">
                <div className="w-12 h-12 rounded-full border-4 border-gray-100 border-t-blue-600 animate-spin mb-4"></div>
                <p className="text-gray-400 text-xs font-black uppercase tracking-widest">Consultando Firebase...</p>
            </div>
        )
    }

    if (orders.length === 0) {
        return (
            <div className="text-center py-20 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i className="bi bi-archive text-2xl text-gray-300"></i>
                </div>
                <h3 className="text-lg font-bold text-gray-900 font-outfit">Sin historial disponible</h3>
                <p className="text-gray-500 text-sm max-w-xs mx-auto mt-2">No se encontraron pedidos registrados en el sistema global.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex items-center justify-between px-2">
                <h2 className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em]">
                    Historial Global • {orders.length} pedidos
                </h2>
            </div>

            <div className="space-y-4">
                {groupedOrders.map(([dateKey, items]) => {
                    const isCollapsed = collapsedDates.has(dateKey)
                    const dayTotal = items.reduce((acc, item) => acc + (item.total || 0), 0)

                    return (
                        <div key={dateKey} className="group">
                            <button
                                onClick={() => toggleDate(dateKey)}
                                className={`w-full flex items-center justify-between p-4 transition-all duration-300 ${isCollapsed ? 'bg-white rounded-2xl border border-gray-200 shadow-sm' : 'bg-gray-900 text-white rounded-t-2xl'
                                    }`}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all duration-500 ${isCollapsed ? 'bg-gray-100 text-gray-500 rotate-0' : 'bg-white/10 text-white rotate-180 shadow-inner'
                                        }`}>
                                        <i className="bi bi-chevron-down text-[10px]"></i>
                                    </div>
                                    <div className="text-left">
                                        <h3 className={`text-sm font-bold capitalize ${isCollapsed ? 'text-gray-900' : 'text-white'}`}>{dateKey}</h3>
                                        <p className={`text-[10px] font-bold uppercase tracking-tighter opacity-60`}>{items.length} TRANSACCIONES</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className={`text-md font-black ${isCollapsed ? 'text-blue-600' : 'text-emerald-400'}`}>
                                        ${dayTotal.toFixed(2)}
                                    </span>
                                </div>
                            </button>

                            {!isCollapsed && (
                                <div className="bg-white border-x border-b border-gray-100 rounded-b-2xl shadow-xl overflow-hidden divide-y divide-gray-50">
                                    {items.map(order => {
                                        const business = businesses.find(b => b.id === order.businessId)
                                        const orderDate = getOrderDate(order)

                                        return (
                                            <div
                                                key={order.id}
                                                onClick={() => onOrderClick(order.id!)}
                                                className="p-4 hover:bg-gray-50 cursor-pointer transition-all flex items-center justify-between group/item"
                                            >
                                                <div className="flex items-center gap-4 min-w-0">
                                                    {/* Logo tienda */}
                                                    <div className="w-10 h-10 rounded-2xl bg-gray-50 flex items-center justify-center shrink-0 border border-gray-100 overflow-hidden group-hover/item:scale-105 group-hover/item:border-blue-100 transition-all shadow-sm">
                                                        {business?.image ? (
                                                            <img src={business.image} className="w-full h-full object-cover" alt="" />
                                                        ) : (
                                                            <i className="bi bi-shop text-gray-300 text-sm"></i>
                                                        )}
                                                    </div>

                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-bold text-gray-900 truncate tracking-tight">
                                                                {order.customer?.name || 'Invitado'}
                                                            </span>
                                                            <span className="text-[10px] text-gray-400 font-mono bg-gray-50 px-1 rounded">
                                                                #{order.id?.slice(-4).toUpperCase()}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <span className="text-[10px] font-black text-blue-500 uppercase tracking-tighter">
                                                                {business?.name || 'DESCONOCIDO'}
                                                            </span>
                                                            <span className="w-1 h-1 rounded-full bg-gray-200"></span>
                                                            <span className="text-[10px] text-gray-400 font-bold">
                                                                {orderDate.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="text-right shrink-0">
                                                    <div className="text-sm font-black text-gray-900 tracking-tighter">
                                                        ${(order.total || 0).toFixed(2)}
                                                    </div>
                                                    <div className={`text-[10px] font-black uppercase tracking-tighter mt-1 ${order.status === 'delivered' ? 'text-emerald-500' :
                                                            order.status === 'cancelled' ? 'text-red-500' :
                                                                order.status === 'pending' ? 'text-amber-500' :
                                                                    'text-indigo-500'
                                                        }`}>
                                                        {getStatusTextList(order.status)}
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
