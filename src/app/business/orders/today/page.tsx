'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Business, Order, Delivery, Product } from '@/types'
import { useBusinessAuth } from '@/contexts/BusinessAuthContext'
import { db } from '@/lib/firebase'
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import {
    getBusiness,
    getProductsByBusiness,
    deleteOrder,
    getCoverageZones,
    isPointInPolygon,
    getDeliveriesByStatus,
    updateOrderStatus
} from '@/lib/database'
import {
    sendWhatsAppToDelivery,
    sendWhatsAppToCustomer,
    getNextStatus
} from '@/components/WhatsAppUtils'
import { printOrder } from '@/lib/print-utils'

// ... existing imports ...

// Helper function to check point in polygon (if not imported, but we added it to imports above)
// If isPointInPolygon is not exported from @/lib/database, we might need to define it here or import it.
// Assuming it is exported based on dashboard/page.tsx usage.

// ... existing code ...

// Auto-assign logic
const autoAssignDeliveryForOrder = async (order: Order): Promise<string | undefined> => {
    try {
        const deliveries = await getDeliveriesByStatus('activo');
        let assignedDeliveryId: string | undefined = undefined;

        // 1. Coverage Zone
        const latlong = order.delivery.latlong;
        if (latlong && !latlong.startsWith('pluscode:')) {
            const [lat, lng] = latlong.split(',').map(Number);
            if (!isNaN(lat) && !isNaN(lng)) {
                const zones = await getCoverageZones();
                const matchingZone = zones.find(zone =>
                    zone.isActive &&
                    zone.assignedDeliveryId &&
                    isPointInPolygon({ lat, lng }, zone.polygon)
                );

                if (matchingZone?.assignedDeliveryId) {
                    const zoneDelivery = deliveries.find(d => d.id === matchingZone.assignedDeliveryId);
                    if (zoneDelivery) {
                        assignedDeliveryId = zoneDelivery.id;
                    }
                }
            }
        }

        // 2. Fallbacks
        if (!assignedDeliveryId) {
            const pedroDelivery = deliveries.find(d => d.celular === '0990815097');
            if (pedroDelivery) {
                assignedDeliveryId = pedroDelivery.id;
            } else {
                const sergioDelivery = deliveries.find(d => d.celular === '0978697867');
                if (sergioDelivery) {
                    assignedDeliveryId = sergioDelivery.id;
                }
            }
        }

        return assignedDeliveryId;
    } catch (error) {
        console.error('Error in autoAssign:', error);
        return undefined;
    }
}



import PaymentManagementModals from '@/components/PaymentManagementModals'
import ManualOrderSidebar from '@/components/ManualOrderSidebar'
import { LiveCheckoutsPanel } from '@/components/LiveCheckoutsPanel'

const getStatusText = (status: string) => {
    switch (status) {
        case 'pending': return 'Pendiente'
        case 'confirmed': return 'Confirmado'
        case 'preparing': return 'Preparando'
        case 'ready': return 'Listo para entrega'
        case 'delivered': return 'Entregado'
        case 'cancelled': return 'Cancelado'
        default: return status
    }
}

const getStatusColor = (status: string) => {
    switch (status) {
        case 'pending': return 'bg-yellow-100 text-yellow-800'
        case 'confirmed': return 'bg-blue-100 text-blue-800'
        case 'preparing': return 'bg-purple-100 text-purple-800'
        case 'ready': return 'bg-green-100 text-green-800'
        case 'delivered': return 'bg-gray-100 text-gray-800'
        case 'cancelled': return 'bg-red-100 text-red-800'
        default: return 'bg-gray-100 text-gray-800'
    }
}

// Helper to convert Firestore timestamp to Date
const toSafeDate = (val: any): Date => {
    if (!val) return new Date()
    if (val instanceof Timestamp) return val.toDate()
    if (val.seconds) return new Date(val.seconds * 1000)
    if (typeof val === 'string') return new Date(val)
    if (val instanceof Date) return val
    return new Date()
}

// Helper to get the display time for an order
const getOrderDisplayTime = (order: Order) => {
    try {
        if (order.timing?.scheduledTime) {
            return order.timing.scheduledTime; // Already formatted as HH:MM
        }
        const date = toSafeDate(order.createdAt);
        return date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '--:--';
    }
}

export default function TodayOrdersPage() {
    const router = useRouter()
    const { businessId, isAuthenticated, authLoading } = useBusinessAuth()

    // activeTab removed
    const [orders, setOrders] = useState<Order[]>([])
    const [loading, setLoading] = useState(true)
    const [availableDeliveries, setAvailableDeliveries] = useState<Delivery[]>([])
    const [business, setBusiness] = useState<Business | null>(null)
    const [products, setProducts] = useState<Product[]>([])

    // Payment Modal State
    const [paymentModalOpen, setPaymentModalOpen] = useState(false)
    const [selectedOrderForPayment, setSelectedOrderForPayment] = useState<Order | null>(null)

    // Delivery Status Modal State
    const [deliveryStatusModalOpen, setDeliveryStatusModalOpen] = useState(false)
    const [selectedOrderForStatusModal, setSelectedOrderForStatusModal] = useState<Order | null>(null)

    // Edit Sidebar State
    const [editSidebarOpen, setEditSidebarOpen] = useState(false)
    const [selectedOrderForEdit, setSelectedOrderForEdit] = useState<Order | null>(null)

    // Customer Contact Modal State
    const [customerContactModalOpen, setCustomerContactModalOpen] = useState(false)
    const [selectedOrderForCustomerContact, setSelectedOrderForCustomerContact] = useState<Order | null>(null)

    // Auth protection
    useEffect(() => {
        if (!authLoading && !isAuthenticated) {
            router.replace('/business/login')
        }
    }, [authLoading, isAuthenticated, router])

    // Fetch business data
    useEffect(() => {
        if (!businessId) return
        const fetchBusiness = async () => {
            try {
                const businessData = await getBusiness(businessId)
                setBusiness(businessData)
            } catch (error) {
                console.error("Error fetching business", error)
            }
        }
        fetchBusiness()
    }, [businessId])

    // Fetch products
    useEffect(() => {
        if (!businessId) return
        const fetchProducts = async () => {
            try {
                const productsData = await getProductsByBusiness(businessId)
                setProducts(productsData)
            } catch (error) {
                console.error("Error fetching products", error)
            }
        }
        fetchProducts()
    }, [businessId])

    // Fetch active deliveries
    useEffect(() => {
        const fetchDeliveries = async () => {
            try {
                const deliveries = await getDeliveriesByStatus('activo')
                setAvailableDeliveries(deliveries)
            } catch (error) {
                console.error("Error fetching deliveries", error)
            }
        }
        fetchDeliveries()
    }, [])

    // Real-time orders listener
    useEffect(() => {
        if (!businessId) return

        setLoading(true)

        // Calculate start and end of today
        const now = new Date()
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

        // Query mostly relies on client-side filtering for dates due to potential index issues
        // but we filter by businessId directly
        const q = query(
            collection(db, 'orders'),
            where('businessId', '==', businessId),
            orderBy('createdAt', 'desc')
        )

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const allOrders = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Order[]

            // Filter for today's orders
            const todayOrders = allOrders.filter(order => {
                const orderDate = toSafeDate(order.createdAt)
                return orderDate >= startOfDay && orderDate < endOfDay
            })

            // Sort by time (nearest first)
            todayOrders.sort((a, b) => {
                const getMinutes = (o: Order) => {
                    if (o.timing?.type === 'scheduled' && o.timing.scheduledTime) {
                        const [h, m] = o.timing.scheduledTime.split(':').map(Number);
                        return h * 60 + m;
                    }
                    const date = toSafeDate(o.createdAt);
                    return date.getHours() * 60 + date.getMinutes();
                };
                return getMinutes(a) - getMinutes(b);
            });

            setOrders(todayOrders)
            setLoading(false)
        }, (error) => {
            console.error("Error listening to orders:", error)
            setLoading(false)
        })

        return () => unsubscribe()
    }, [businessId])

    // Derived state for tabs removed

    // Handlers
    const handleStatusChange = async (orderId: string, newStatus: Order['status']) => {
        try {
            const currentOrder = orders.find(o => o.id === orderId);
            let assignmentUpdate: any = {};

            // Auto-assign if confirming a pending delivery order
            if (currentOrder && currentOrder.status === 'pending' && newStatus !== 'cancelled' && newStatus !== 'pending') {
                if (currentOrder.delivery?.type === 'delivery' && !currentOrder.delivery.assignedDelivery) {
                    const assignedId = await autoAssignDeliveryForOrder(currentOrder);
                    if (assignedId) {
                        assignmentUpdate['delivery.assignedDelivery'] = assignedId;
                    }
                }
            }

            await updateOrderStatus(orderId, newStatus)

            if (Object.keys(assignmentUpdate).length > 0) {
                const orderRef = doc(db, 'orders', orderId);
                await updateDoc(orderRef, assignmentUpdate);
            }
        } catch (error) {
            console.error("Error updating status:", error)
            alert("Error al actualizar estado")
        }
    }

    const handleDeliveryAssignment = async (orderId: string, deliveryId: string) => {
        try {
            const orderRef = doc(db, 'orders', orderId)
            await updateDoc(orderRef, {
                'delivery.assignedDelivery': deliveryId || null
            })
        } catch (error) {
            console.error("Error assigning delivery:", error)
            alert("Error al asignar repartidor")
        }
    }

    const handlePaymentClick = (order: Order) => {
        setSelectedOrderForPayment(order)
        setPaymentModalOpen(true)
    }

    const handleOrderUpdatedFromModal = (updatedOrder: Order) => {
        // The snapshot listener will automatically update the list, 
        // but we might want to update the local state for immediate feedback if needed.
        // Since we rely on snapshot, we effectively just close the modal.
        // However, if we need to update the selected order in the modal context:
        if (selectedOrderForPayment?.id === updatedOrder.id) {
            setSelectedOrderForPayment(updatedOrder)
        }
    }

    const handleSendWhatsAppAndAdvance = async (order: Order) => {
        try {
            await sendWhatsAppToDelivery(
                order,
                availableDeliveries,
                business,
                async (id, status) => { await handleStatusChange(id, status) },
                (updatedOrder) => { /* Local update if needed */ }
            )
        } catch (e) {
            console.error("Error sending WhatsApp", e)
            alert("Error al enviar WhatsApp")
        }
    }

    const handleDeleteOrder = async (orderId: string) => {
        if (!window.confirm('¿Estás seguro de que deseas eliminar este pedido?')) return

        try {
            await deleteOrder(orderId)
        } catch (error) {
            console.error("Error deleting order", error)
            alert("No se pudo eliminar el pedido")
        }
    }

    const handlePrint = async (order: Order) => {
        try {
            await printOrder({
                order: order as any,
                businessName: business?.name || "Negocio",
                businessLogo: business?.image
            })
        } catch (e) {
            console.error("Error printing", e)
            alert("Error al imprimir")
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 pb-20">
            {/* Header */}
            <div className="bg-white px-4 py-3 shadow-sm sticky top-0 z-10">
                <div className="flex justify-between items-center mb-4">
                    <h1 className="text-xl font-bold text-gray-900">Pedidos de Hoy</h1>
                    <button
                        onClick={() => router.back()}
                        className="p-2 text-gray-500 hover:bg-gray-100 rounded-full"
                    >
                        <i className="bi bi-x-lg"></i>
                    </button>
                </div>

            </div>

            {/* Orders List by Status */}
            <div className="p-4 space-y-6">
                {['pending', 'confirmed', 'preparing', 'ready', 'on_way', 'delivered', 'cancelled'].map(status => {
                    const statusOrders = orders.filter(o => o.status === status);
                    if (statusOrders.length === 0) return null;

                    return (
                        <CollapsibleSection
                            key={status}
                            title={getStatusText(status)}
                            count={statusOrders.length}
                            status={status}
                            defaultExpanded={!['delivered', 'cancelled'].includes(status)}
                        >
                            {statusOrders.length === 0 ? (
                                <p className="text-sm text-gray-400 italic text-center py-2">No hay pedidos en este estado</p>
                            ) : (
                                statusOrders.map(order => (
                                    <OrderCard
                                        key={order.id}
                                        order={order}
                                        availableDeliveries={availableDeliveries}
                                        onStatusChange={handleStatusChange}
                                        onDeliveryAssign={handleDeliveryAssignment}
                                        onPaymentEdit={() => handlePaymentClick(order)}
                                        onWhatsAppDelivery={() => handleSendWhatsAppAndAdvance(order)}
                                        onPrint={() => handlePrint(order)}
                                        onDeliveryStatusClick={(order) => {
                                            setSelectedOrderForStatusModal(order)
                                            setDeliveryStatusModalOpen(true)
                                        }}
                                        onEdit={() => {
                                            setSelectedOrderForEdit(order)
                                            setEditSidebarOpen(true)
                                        }}
                                        onDelete={() => handleDeleteOrder(order.id)}
                                        onCustomerClick={() => {
                                            setSelectedOrderForCustomerContact(order)
                                            setCustomerContactModalOpen(true)
                                        }}
                                        businessPhone={business?.phone}
                                    />
                                ))
                            )}
                        </CollapsibleSection>
                    )
                })}
            </div>

            {/* Live Checkouts Panel - Moved to bottom */}
            {businessId && <div className="p-4"><LiveCheckoutsPanel businessId={businessId} /></div>}

            <PaymentManagementModals
                isOpen={paymentModalOpen}
                onClose={() => setPaymentModalOpen(false)}
                order={selectedOrderForPayment}
                onOrderUpdated={handleOrderUpdatedFromModal}
            />

            <DeliveryStatusModal
                isOpen={deliveryStatusModalOpen}
                onClose={() => setDeliveryStatusModalOpen(false)}
                order={selectedOrderForStatusModal}
                deliveryAgent={availableDeliveries.find(d => d.id === selectedOrderForStatusModal?.delivery?.assignedDelivery)}
                onWhatsApp={() => {
                    if (selectedOrderForStatusModal) {
                        handleSendWhatsAppAndAdvance(selectedOrderForStatusModal)
                        setDeliveryStatusModalOpen(false)
                    }
                }}
            />

            <ManualOrderSidebar
                isOpen={editSidebarOpen}
                onClose={() => setEditSidebarOpen(false)}
                business={business}
                products={products}
                onOrderCreated={() => { }} // Not used in edit mode
                mode="edit"
                editOrder={selectedOrderForEdit}
                onOrderUpdated={() => {
                    setEditSidebarOpen(false)
                    setSelectedOrderForEdit(null)
                    // Real-time listener handles the update
                }}
            />

            <CustomerContactModal
                isOpen={customerContactModalOpen}
                onClose={() => setCustomerContactModalOpen(false)}
                order={selectedOrderForCustomerContact}
            />
        </div>
    )
}

function CustomerContactModal({
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
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

function DeliveryStatusModal({
    isOpen,
    onClose,
    order,
    deliveryAgent,
    onWhatsApp
}: {
    isOpen: boolean,
    onClose: () => void,
    order: Order | null,
    deliveryAgent?: Delivery,
    onWhatsApp: () => void
}) {
    if (!isOpen || !order) return null

    const status = order.delivery?.acceptanceStatus

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="p-6">
                    <div className="flex justify-between items-start mb-6">
                        <h3 className="text-xl font-bold text-gray-900">Estado del Delivery</h3>
                        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg text-gray-400">
                            <i className="bi bi-x-lg"></i>
                        </button>
                    </div>

                    <div className="space-y-6">
                        {/* Agent Info */}
                        <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                                <i className="bi bi-person-fill text-2xl"></i>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 font-medium">Repartidor Asignado</p>
                                <p className="text-lg font-bold text-gray-900">{deliveryAgent?.nombres || 'No identificado'}</p>
                            </div>
                        </div>

                        {/* Confirmation Status */}
                        <div className="flex items-start gap-3">
                            <div className={`mt-1 w-2 h-2 rounded-full ${status === 'accepted' ? 'bg-green-500' :
                                status === 'rejected' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'
                                }`} />
                            <div>
                                <p className="font-bold text-gray-900">
                                    {status === 'accepted' ? 'Confirmado' :
                                        status === 'rejected' ? 'Rechazado' : 'Esperando confirmación'}
                                </p>
                                <p className="text-sm text-gray-500">
                                    {status === 'accepted' ? 'El repartidor ya aceptó el pedido y está en camino.' :
                                        status === 'rejected' ? 'El repartidor ha rechazado el pedido.' : 'El repartidor aún no ha respondido a la notificación.'}
                                </p>
                            </div>
                        </div>

                        {/* WhatsApp Action */}
                        <button
                            onClick={onWhatsApp}
                            className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-200"
                        >
                            <i className="bi bi-whatsapp text-xl"></i>
                            Enviar mensaje al Delivery
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

const getActionIcon = (status: string) => {
    switch (status) {
        case 'preparing': return 'bi-fire text-orange-500'
        case 'ready': return 'bi-check2 text-green-600'
        case 'delivered': return 'bi-stars text-purple-500'
        default: return 'bi-arrow-right'
    }
}

const getActionText = (status: string) => {
    switch (status) {
        case 'confirmed': return 'Confirmar'
        case 'preparing': return 'Preparando'
        case 'ready': return 'Listo para la entrega'
        case 'delivered': return 'Entregado'
        default: return getStatusText(status)
    }
}

const getActionEmoji = (status: string) => {
    switch (status) {
        case 'preparing': return '🔥'
        case 'ready': return '✔️'
        case 'delivered': return '🎉'
        default: return '➡️'
    }
}

function CollapsibleSection({
    title,
    count,
    status,
    children,
    defaultExpanded = true
}: {
    title: string,
    count: number,
    status: string,
    children: React.ReactNode,
    defaultExpanded?: boolean
}) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded)

    const getDotColor = (s: string) => {
        switch (s) {
            case 'pending': return 'bg-yellow-500 shadow-yellow-200'
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-3 flex justify-between items-center bg-gray-50/50 hover:bg-gray-100 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full shadow-sm ${getDotColor(status)}`}></span>
                    <h3 className="font-bold text-gray-800 text-lg">{title}</h3>
                    <span className="bg-white border border-gray-200 text-gray-600 text-xs font-bold px-2.5 py-0.5 rounded-full">{count}</span>
                </div>
                <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 transition-transform duration-200`}></i>
            </button>

            {isExpanded && (
                <div className="p-4 space-y-3 bg-gray-50/30 border-t border-gray-100 animate-in slide-in-from-top-2 duration-200">
                    {children}
                </div>
            )}
        </div>
    )
}

function OrderCard({
    order,
    availableDeliveries,
    onStatusChange,
    onDeliveryAssign,
    onPaymentEdit,
    onWhatsAppDelivery,
    onPrint,
    onDeliveryStatusClick,
    onEdit,
    onDelete,
    onCustomerClick,
    businessPhone
}: {
    order: Order,
    availableDeliveries: Delivery[],
    onStatusChange: (id: string, status: Order['status']) => void,
    onDeliveryAssign: (id: string, deliveryId: string) => void,
    onPaymentEdit: () => void,
    onWhatsAppDelivery: () => void,
    onPrint: () => void,
    onDeliveryStatusClick: (order: Order) => void,
    onEdit: () => void,
    onDelete: () => void,
    onCustomerClick: () => void,
    businessPhone?: string
}) {
    const nextStatus = getNextStatus(order.status)
    const isDelivery = order.delivery?.type === 'delivery'
    const [isExpanded, setIsExpanded] = useState(false)

    // Urgency check
    const isUrgent = () => {
        // Only for active orders that are not ready or delivered
        if (['ready', 'delivered', 'completed', 'cancelled'].includes(order.status)) return false;

        const now = new Date();
        let targetDate = new Date();

        if (order.timing?.scheduledTime) {
            const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number);
            targetDate.setHours(hours, minutes, 0, 0);
        } else {
            // For immediate orders, maybe check if created more than 30 mins ago?
            // User specifically asked for "less than 5 mins for delivery".
            // If no scheduled time, we can't really know unless we assume a standard time.
            // For now, let's stick to scheduled times or maybe immediate orders created > 40 mins ago?
            // Let's stick to strict interpretation: if scheduled and < 5 mins left.
            return false;
        }

        const diffInMinutes = (targetDate.getTime() - now.getTime()) / 60000;
        return diffInMinutes <= 5;
    }

    const urgent = isUrgent();

    // Sort items: non-zero price first, then zero price
    const sortedItems = [...(order.items || [])].sort((a: any, b: any) => {
        const priceA = (a.price || a.product?.price || 0) * a.quantity;
        const priceB = (b.price || b.product?.price || 0) * b.quantity;

        if (priceA === 0 && priceB !== 0) return 1;
        if (priceA !== 0 && priceB === 0) return -1;
        return 0; // Keep original order if both are zero or both are non-zero
    });

    return (
        <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden transition-all ${urgent ? 'animate-pulse border-red-300 ring-2 ring-red-100' : ''}`}>
            {/* Card Header: Time & Status */}
            <div
                className="px-4 py-3 border-b border-gray-50 flex justify-between items-start bg-gray-50/50 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                        {/* Chevron for expand/collapse */}
                        <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 text-xs mr-2 transform transition-transform duration-200`}></i>

                        <span
                            className="text-sm font-bold text-gray-900 flex items-center gap-2 hover:text-red-600 transition-colors"
                            onClick={(e) => {
                                e.stopPropagation()
                                onCustomerClick()
                            }}
                        >
                            <i className={`bi ${isDelivery ? 'bi-scooter' : 'bi-shop'} text-gray-400`}></i>
                            {order.customer?.name || "Cliente"}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1 ml-5">
                        <i className={`bi ${order.timing?.type === 'scheduled' ? 'bi-clock' : 'bi-lightning-fill'} ${order.timing?.type === 'scheduled' ? 'text-blue-600' : 'text-yellow-500'}`}></i>
                        <span className="font-mono font-medium text-gray-600">
                            {getOrderDisplayTime(order)}
                        </span>
                    </div>

                    {/* Items List (Small) */}
                    <div className="flex flex-col gap-0.5 mt-1 ml-5">
                        {sortedItems.map((item: any, idx) => {
                            const price = (item.price || item.product?.price || 0) * item.quantity;
                            return (
                                <div key={idx} className={`text-[10px] leading-tight truncate ${price === 0 ? 'text-gray-400 italic' : 'text-gray-600'}`}>
                                    {item.quantity}x {item.variant || item.product?.name || item.name}
                                </div>
                            )
                        })}
                    </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        {/* Advance Status */}
                        {nextStatus && (
                            <button
                                onClick={() => onStatusChange(order.id, nextStatus)}
                                className={`flex items-center gap-1 rounded-lg transition-colors shadow-sm ${nextStatus === 'confirmed'
                                    ? 'px-3 py-1.5 text-xs font-bold bg-green-600 text-white hover:bg-green-700'
                                    : 'p-1.5 text-lg hover:bg-white hover:shadow-md'
                                    }`}
                                title={getActionText(nextStatus)}
                            >
                                {nextStatus === 'confirmed' ? (
                                    <>
                                        <span>{getActionText(nextStatus)}</span>
                                        <i className="bi bi-check2-circle"></i>
                                    </>
                                ) : (
                                    <i className={`bi ${getActionIcon(nextStatus)}`}></i>
                                )}
                            </button>
                        )}

                        {/* Delivery Acceptance Status */}
                        {isDelivery && order.delivery?.assignedDelivery && (
                            <div
                                className="p-1.5 flex items-center cursor-pointer hover:bg-white hover:shadow-sm rounded-lg transition-all"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onDeliveryStatusClick(order)
                                }}
                                title={
                                    order.delivery?.acceptanceStatus === 'accepted' ? 'Delivery Confirmado' :
                                        order.delivery?.acceptanceStatus === 'rejected' ? 'Delivery Rechazado' :
                                            'Esperando confirmación del delivery'
                                }
                            >
                                <span className={`material-symbols-rounded text-2xl transition-all ${order.delivery?.acceptanceStatus === 'accepted'
                                    ? 'text-green-500'
                                    : order.delivery?.acceptanceStatus === 'rejected'
                                        ? 'text-red-500'
                                        : 'text-yellow-500 animate-pulse'
                                    }`}>
                                    motorcycle
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Card Body */}
            {isExpanded && (
                <div className="p-4 bg-white animate-in slide-in-from-top-2 duration-200">
                    {/* Customer Info */}
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex-1 pr-2">
                            {isDelivery && (
                                <p className="text-sm text-gray-500 line-clamp-2">
                                    📍 {order.delivery?.references || (order.delivery as any)?.reference || "Ubicación"}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Items */}
                    <div className="space-y-2 mb-4">
                        {order.items?.map((item: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-sm">
                                <span className="text-gray-700">
                                    <span className="font-medium text-gray-900">{item.quantity}x</span> {item.variant || item.product?.name || item.name}
                                </span>
                                <span className="text-gray-500">${((item.price || item.product?.price || 0) * item.quantity).toFixed(2)}</span>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-dashed border-gray-200 my-3"></div>

                    {/* Total & Payment */}
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
                                <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-credit-card' :
                                    order.payment?.method === 'mixed' ? 'bi-cash-coin' : 'bi-cash'
                                    }`}></i>
                                <span>${(order.total || 0).toFixed(2)}</span>
                                <i className="bi bi-pencil-square text-xs opacity-50 ml-1"></i>
                            </button>
                        </div>

                        {/* Print Button */}
                        <button
                            onClick={onPrint}
                            className="p-2 text-gray-400 hover:text-gray-600"
                        >
                            <i className="bi bi-printer"></i>
                        </button>
                    </div>

                    {/* Delivery Assignment */}
                    {isDelivery && (
                        <div className="mb-4">
                            <div className="flex items-center border border-gray-300 rounded-lg bg-white overflow-hidden">
                                <div className="bg-gray-100 px-3 py-2 border-r border-gray-300 text-gray-600">
                                    <i className="bi bi-truck text-lg"></i>
                                </div>
                                <select
                                    value={order.delivery?.assignedDelivery || ""}
                                    onChange={(e) => onDeliveryAssign(order.id, e.target.value)}
                                    className="w-full text-sm p-2 bg-transparent outline-none cursor-pointer hover:bg-gray-50 transition-colors"
                                >
                                    <option value="">Asignar Repartidor...</option>
                                    {availableDeliveries.map(d => (
                                        <option key={d.id} value={d.id}>{d.nombres}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Actions: Edit & Delete */}
                    <div className="flex gap-2 pt-4 border-t border-gray-100">
                        <button
                            onClick={onEdit}
                            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                            <i className="bi bi-pencil"></i>
                            Editar Pedido
                        </button>
                        <button
                            onClick={onDelete}
                            className="flex items-center justify-center p-2 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                        >
                            <i className="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
