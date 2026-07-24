'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Business, Order, Delivery } from '@/types'
import { db } from '@/lib/firebase'
import { collection, query, where, onSnapshot, doc, updateDoc, Timestamp } from 'firebase/firestore'

// Helper to convert Firestore timestamp to Date
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

// Helper to format Date to local string YYYY-MM-DD
const getLocalDateString = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const getOrderReferenceDate = (order: Order): Date => {
    return order.timing?.scheduledDate
        ? toSafeDate(order.timing.scheduledDate)
        : toSafeDate(order.createdAt)
}

// Helper to get the display time for an order
const getOrderDisplayTime = (order: Order) => {
    try {
        if (order.timing?.scheduledTime) {
            return order.timing.scheduledTime;
        }
        const date = toSafeDate(order.createdAt);
        return date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '--:--';
    }
}

// Helper para formatear número de celular para WhatsApp en Ecuador
const formatWhatsAppPhone = (phone: string): string => {
    if (!phone) return ''
    let cleaned = phone.replace(/\D/g, '')
    if (cleaned.startsWith('00')) {
        cleaned = cleaned.substring(2)
    }
    if (cleaned.startsWith('593')) {
        return cleaned
    }
    if (cleaned.startsWith('0')) {
        return '593' + cleaned.substring(1)
    }
    if (cleaned.length === 9 && cleaned.startsWith('9')) {
        return '593' + cleaned
    }
    return cleaned
}

// Helper para formatear montos: entero si no tiene decimales (20, 10), 2 decimales si tiene fracción (3.75)
const formatMoney = (val: number): string => {
    const absVal = Math.abs(val)
    if (Number.isInteger(absVal) || absVal % 1 === 0) {
        return absVal.toString()
    }
    return absVal.toFixed(2)
}

interface CierreSidebarViewProps {
    orders: Order[]
    availableDeliveries: Delivery[]
    onBack: () => void
    onClose?: () => void
    selectedBusinessId: string | null
    businesses: Business[]
    onManagePayment: (order: Order) => void
}

// Función helper pura para calcular el resumen de cuentas de los repartidores
function calculateDeliveryAccounts(
    ordersList: Order[],
    deliveriesList: Delivery[],
    settlementOverrides?: Record<string, 'settled' | 'pending'>
) {
    const accountsMap = new Map<string, {
        deliveryId: string
        name: string
        celular: string
        orderCount: number
        pendingOrderCount: number
        settledOrderCount: number
        cashCollected: number // pending cash
        transferCollected: number // pending transfer
        deliveryFeeEarned: number // pending fee
        settledCashCollected: number
        settledTransferCollected: number
        settledDeliveryFeeEarned: number
        ordersList: Order[]
    }>()

    // Inicializar con todos los repartidores activos disponibles
    deliveriesList.forEach(d => {
        accountsMap.set(d.id, {
            deliveryId: d.id,
            name: d.nombres || 'Sin nombre',
            celular: d.celular || '',
            orderCount: 0,
            pendingOrderCount: 0,
            settledOrderCount: 0,
            cashCollected: 0,
            transferCollected: 0,
            deliveryFeeEarned: 0,
            settledCashCollected: 0,
            settledTransferCollected: 0,
            settledDeliveryFeeEarned: 0,
            ordersList: []
        })
    })

    // También agregar una categoría "Sin Asignar"
    const unassignedId = 'unassigned'
    accountsMap.set(unassignedId, {
        deliveryId: unassignedId,
        name: 'Sin Repartidor / Pendiente',
        celular: '',
        orderCount: 0,
        pendingOrderCount: 0,
        settledOrderCount: 0,
        cashCollected: 0,
        transferCollected: 0,
        deliveryFeeEarned: 0,
        settledCashCollected: 0,
        settledTransferCollected: 0,
        settledDeliveryFeeEarned: 0,
        ordersList: []
    })

    ordersList.forEach(o => {
        // Solo miramos pedidos de tipo entrega (delivery)
        if (o.delivery?.type !== 'delivery') return

        const driverId = o.delivery?.assignedDelivery || unassignedId
        let acc = accountsMap.get(driverId)
        
        if (!acc) {
            acc = {
                deliveryId: driverId,
                name: `Repartidor ID: ${driverId.substring(0, 6)}...`,
                celular: '',
                orderCount: 0,
                pendingOrderCount: 0,
                settledOrderCount: 0,
                cashCollected: 0,
                transferCollected: 0,
                deliveryFeeEarned: 0,
                settledCashCollected: 0,
                settledTransferCollected: 0,
                settledDeliveryFeeEarned: 0,
                ordersList: []
            }
            accountsMap.set(driverId, acc)
        }

        acc.orderCount++
        acc.ordersList.push(o)

        const effectiveSettlementStatus = (settlementOverrides && settlementOverrides[o.id]) || o.deliverySettlementStatus
        const isSettled = effectiveSettlementStatus === 'settled'
        const method = o.payment?.method || 'cash'
        const total = o.total || 0
        const deliveryFee = o.delivery?.deliveryCost || 0

        let orderCash = 0
        let orderTransfer = 0

        if (method === 'cash') {
            orderCash = total
        } else if (method === 'transfer') {
            orderTransfer = total
        } else if (method === 'mixed') {
            orderCash = o.payment?.cashAmount || 0
            orderTransfer = o.payment?.transferAmount || 0
        }

        if (isSettled) {
            acc.settledOrderCount++
            acc.settledCashCollected += orderCash
            acc.settledTransferCollected += orderTransfer
            acc.settledDeliveryFeeEarned += deliveryFee
        } else {
            acc.pendingOrderCount++
            acc.cashCollected += orderCash
            acc.transferCollected += orderTransfer
            acc.deliveryFeeEarned += deliveryFee
        }
    })

    // Filtrar para incluir únicamente los repartidores que tienen pedidos en este período/día
    const list = Array.from(accountsMap.values()).filter(acc => acc.orderCount > 0)

    list.sort((a, b) => {
        if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount
        return a.name.localeCompare(b.name)
    })

    return list
}

// Función helper para calcular el resumen de cuentas por Restaurantes
function calculateStoreAccounts(
    ordersList: Order[],
    businessesList: Business[],
    collectorOverrides?: Record<string, 'fuddi' | 'store'>,
    settlementOverrides?: Record<string, 'settled' | 'pending'>
) {
    const storeMap = new Map<string, {
        businessId: string
        name: string
        orderCount: number
        pendingOrderCount: number
        settledOrderCount: number
        cashCollected: number
        digitalCollected: number
        commission: number
        netBalance: number
        settledCashCollected: number
        settledDigitalCollected: number
        settledCommission: number
        settledNetBalance: number
        ordersList: Order[]
    }>()

    businessesList.forEach(b => {
        storeMap.set(b.id, {
            businessId: b.id,
            name: b.name || 'Sin nombre',
            orderCount: 0,
            pendingOrderCount: 0,
            settledOrderCount: 0,
            cashCollected: 0,
            digitalCollected: 0,
            commission: 0,
            netBalance: 0,
            settledCashCollected: 0,
            settledDigitalCollected: 0,
            settledCommission: 0,
            settledNetBalance: 0,
            ordersList: []
        })
    })

    ordersList.forEach(o => {
        if (!o.businessId) return
        let acc = storeMap.get(o.businessId)
        if (!acc) {
            acc = {
                businessId: o.businessId,
                name: businessesList.find(b => b.id === o.businessId)?.name || (o as any).businessName || `Restaurante ${o.businessId.substring(0, 6)}...`,
                orderCount: 0,
                pendingOrderCount: 0,
                settledOrderCount: 0,
                cashCollected: 0,
                digitalCollected: 0,
                commission: 0,
                netBalance: 0,
                settledCashCollected: 0,
                settledDigitalCollected: 0,
                settledCommission: 0,
                settledNetBalance: 0,
                ordersList: []
            }
            storeMap.set(o.businessId, acc)
        }

        acc.orderCount++
        acc.ordersList.push(o)

        const effectiveSettlementStatus = (settlementOverrides && settlementOverrides[o.id]) || o.settlementStatus
        const isSettled = effectiveSettlementStatus === 'settled'
        const isPickup = o.delivery?.type === 'pickup'
        const isCash = o.payment?.method === 'cash'
        const effectiveCollector = (collectorOverrides && collectorOverrides[o.id])
            || (o.paymentCollector ? o.paymentCollector : (isPickup && isCash ? 'store' : 'fuddi'))
        const isStoreMoney = effectiveCollector === 'store'

        // Excluir el costo del delivery del valor de la tienda (el envío pertenece al repartidor)
        const deliveryFee = o.delivery?.type === 'delivery' ? (o.delivery?.deliveryCost || 0) : 0
        const productSubtotal = o.subtotal || Math.max(0, (o.total || 0) - deliveryFee)

        let orderCommission = 0
        if (o.items && o.items.length > 0) {
            o.items.forEach((item: any) => {
                orderCommission += (item.commission || 0) * (item.quantity || 1)
            })
        }

        const cashAmount = isStoreMoney ? productSubtotal : 0
        const digitalAmount = isStoreMoney ? 0 : productSubtotal

        if (isSettled) {
            acc.settledOrderCount++
            acc.settledCashCollected += cashAmount
            acc.settledDigitalCollected += digitalAmount
            acc.settledCommission += orderCommission
            acc.settledNetBalance = acc.settledDigitalCollected - acc.settledCommission
        } else {
            acc.pendingOrderCount++
        }

        // Siempre acumular en el balance general de la tienda para la fecha
        acc.cashCollected += cashAmount
        acc.digitalCollected += digitalAmount
        acc.commission += orderCommission
        acc.netBalance = acc.digitalCollected - acc.commission
    })

    const list = Array.from(storeMap.values()).filter(acc => acc.orderCount > 0)
    list.sort((a, b) => {
        if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount
        return a.name.localeCompare(b.name)
    })

    return list
}

export default function CierreSidebarView({
    orders,
    availableDeliveries,
    onBack,
    onClose,
    selectedBusinessId,
    businesses,
    onManagePayment
}: CierreSidebarViewProps) {
    // Estados principales
    const [entityType, setEntityType] = useState<'deliveries' | 'restaurants'>('deliveries')
    const [selectedDeliveryId, setSelectedDeliveryId] = useState<string>('all')
    const [selectedStoreId, setSelectedStoreId] = useState<string>('all')
    const [collapsedGroups, setCollapsedGroups] = useState<{ cash: boolean, transfer: boolean, mixed: boolean }>({
        cash: false,
        transfer: false,
        mixed: false
    })
    const [selectedStoreFilterId, setSelectedStoreFilterId] = useState<string>('all')

    // Estados de Historial y Colapsables de Restaurantes
    const [historyOrders, setHistoryOrders] = useState<Order[]>([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [daysToShow, setDaysToShow] = useState(15)
    const [expandedDay, setExpandedDay] = useState<string | null>(null)
    const [selectedHistoryDelivery, setSelectedHistoryDelivery] = useState<{ dateStr: string, deliveryId: string } | null>(null)
    const [selectedHistoryStoreFilterId, setSelectedHistoryStoreFilterId] = useState<string>('all')

    const [expandedRestaurants, setExpandedRestaurants] = useState<Record<string, boolean>>({})
    const [expandedRestaurantDays, setExpandedRestaurantDays] = useState<Record<string, boolean>>({})
    const [localCollectorOverrides, setLocalCollectorOverrides] = useState<Record<string, 'fuddi' | 'store'>>({})
    const [localSettlementStatusOverrides, setLocalSettlementStatusOverrides] = useState<Record<string, 'settled' | 'pending'>>({})
    const [restaurantSubTab, setRestaurantSubTab] = useState<'pending' | 'history'>('pending')
    const [storeToSettle, setStoreToSettle] = useState<any | null>(null)

    // Estados de Deliverys agrupados por día
    const [deliverySubTab, setDeliverySubTab] = useState<'pending' | 'history'>('pending')
    const [expandedDeliveryDays, setExpandedDeliveryDays] = useState<Record<string, boolean>>({})
    const [expandedDayDeliveries, setExpandedDayDeliveries] = useState<Record<string, boolean>>({})
    const [localDeliverySettlementOverrides, setLocalDeliverySettlementOverrides] = useState<Record<string, 'settled' | 'pending'>>({})

    const toggleRestaurantExpand = (businessId: string) => {
        setExpandedRestaurants(prev => ({
            ...prev,
            [businessId]: !prev[businessId]
        }))
    }

    const toggleRestaurantDayExpand = (key: string) => {
        setExpandedRestaurantDays(prev => ({
            ...prev,
            [key]: !prev[key]
        }))
    }

    const toggleDeliveryDayExpand = (dateStr: string) => {
        setExpandedDeliveryDays(prev => ({
            ...prev,
            [dateStr]: !prev[dateStr]
        }))
    }

    const toggleDayDeliveryExpand = (driverKey: string) => {
        setExpandedDayDeliveries(prev => ({
            ...prev,
            [driverKey]: !prev[driverKey]
        }))
    }

    // Reiniciar estados al cambiar de repartidor hoy
    useEffect(() => {
        setCollapsedGroups({ cash: false, transfer: false, mixed: false })
        setSelectedStoreFilterId('all')
    }, [selectedDeliveryId])

    // Reiniciar estados del detalle del repartidor en el historial al cambiar la selección
    useEffect(() => {
        setSelectedHistoryStoreFilterId('all')
    }, [selectedHistoryDelivery])

    // Carga de órdenes del Historial en tiempo real
    useEffect(() => {
        if (!selectedBusinessId) return

        setHistoryLoading(true)
        const now = new Date()
        // Cargar desde hace N días (empezando al inicio de ese día)
        const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToShow)

        const q = selectedBusinessId === 'all'
            ? query(
                collection(db, 'orders'),
                where('createdAt', '>=', Timestamp.fromDate(startDate))
              )
            : query(
                collection(db, 'orders'),
                where('businessId', '==', selectedBusinessId),
                where('createdAt', '>=', Timestamp.fromDate(startDate))
              )

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Order[]
            
            // Ordenar descendentemente en el cliente por fecha de referencia/creación
            data.sort((a, b) => {
                const dateA = getOrderReferenceDate(a)
                const dateB = getOrderReferenceDate(b)
                return dateB.getTime() - dateA.getTime()
            })

            setHistoryOrders(data)
            setHistoryLoading(false)
        }, (error) => {
            console.error("Error loading history for settlement:", error)
            setHistoryLoading(false)
        })

        return () => unsubscribe()
    }, [selectedBusinessId, daysToShow])

    const [settling, setSettling] = useState(false)

    // Liquidar un repartidor individual
    const handleSettleDriver = async (driverId: string, driverName: string, pendingOrders: Order[]) => {
        if (pendingOrders.length === 0) return

        const totalCash = pendingOrders.reduce((sum, o) => {
            const method = o.payment?.method || 'cash'
            if (method === 'cash') return sum + (o.total || 0)
            if (method === 'mixed') return sum + (o.payment?.cashAmount || 0)
            return sum
        }, 0)

        const totalFee = pendingOrders.reduce((sum, o) => sum + (o.delivery?.deliveryCost || 0), 0)
        const netCash = totalCash - totalFee

        const confirmMsg = `¿Marcar como LIQUIDADO a ${driverName}?\n\n` +
            `• Pedidos a liquidar: ${pendingOrders.length}\n` +
            `• Efectivo a recibir: $${totalCash.toFixed(2)}\n` +
            `• Delivery a deducir: $${totalFee.toFixed(2)}\n` +
            `• Saldo neto a entregar: $${netCash.toFixed(2)}\n\n` +
            `Esta acción registrará las cuentas como saldadas. ¿Deseas continuar?`

        if (!window.confirm(confirmMsg)) return

        setSettling(true)
        try {
            const updatePromises = pendingOrders.map(order => {
                const method = order.payment?.method || 'cash'
                const updateData: any = {
                    deliverySettlementStatus: 'settled'
                }
                if (method === 'cash' || method === 'mixed') {
                    updateData['payment.paymentStatus'] = 'paid'
                }
                return updateDoc(doc(db, 'orders', order.id), updateData)
            })
            await Promise.all(updatePromises)
            alert(`Cuentas de ${driverName} liquidadas con éxito.`)
        } catch (error) {
            console.error("Error settling driver:", error)
            alert("Ocurrió un error al liquidar las cuentas. Inténtalo de nuevo.")
        } finally {
            setSettling(false)
        }
    }

    // Liquidar todo el día anterior
    const handleSettleDay = async (dateDisplay: string, pendingOrders: Order[]) => {
        if (pendingOrders.length === 0) return

        const totalCash = pendingOrders.reduce((sum, o) => {
            const method = o.payment?.method || 'cash'
            if (method === 'cash') return sum + (o.total || 0)
            if (method === 'mixed') return sum + (o.payment?.cashAmount || 0)
            return sum
        }, 0)

        const totalFee = pendingOrders.reduce((sum, o) => sum + (o.delivery?.deliveryCost || 0), 0)
        const netCash = totalCash - totalFee

        const confirmMsg = `¿Marcar como LIQUIDADO todo el día ${dateDisplay}?\n\n` +
            `• Pedidos a liquidar: ${pendingOrders.length}\n` +
            `• Efectivo total a recibir: $${totalCash.toFixed(2)}\n` +
            `• Delivery total a deducir: $${totalFee.toFixed(2)}\n` +
            `• Saldo neto total: $${netCash.toFixed(2)}\n\n` +
            `Esta acción registrará TODAS las cuentas de este día como saldadas. ¿Deseas continuar?`

        if (!window.confirm(confirmMsg)) return

        setSettling(true)
        try {
            const updatePromises = pendingOrders.map(order => {
                const method = order.payment?.method || 'cash'
                const updateData: any = {
                    deliverySettlementStatus: 'settled'
                }
                if (method === 'cash' || method === 'mixed') {
                    updateData['payment.paymentStatus'] = 'paid'
                }
                return updateDoc(doc(db, 'orders', order.id), updateData)
            })
            await Promise.all(updatePromises)
            alert(`Día ${dateDisplay} liquidado con éxito.`)
        } catch (error) {
            console.error("Error settling day:", error)
            alert("Ocurrió un error al liquidar el día. Inténtalo de nuevo.")
        } finally {
            setSettling(false)
        }
    }

    // Liquidar un pedido de tienda individual con actualización optimista inmediata
    const handleSettleStoreOrder = async (order: Order) => {
        const currentStatus = localSettlementStatusOverrides[order.id] || order.settlementStatus
        const newStatus: 'settled' | 'pending' = currentStatus === 'settled' ? 'pending' : 'settled'

        // 1. Actualización optimista visual inmediata
        setLocalSettlementStatusOverrides(prev => ({
            ...prev,
            [order.id]: newStatus
        }))

        // 2. Persistencia en Firestore en segundo plano
        try {
            const orderRef = doc(db, 'orders', order.id)
            await updateDoc(orderRef, {
                settlementStatus: newStatus
            })
        } catch (error) {
            console.error("Error liquidando pedido de tienda:", error)
            // Revertir estado optimista en caso de falla
            setLocalSettlementStatusOverrides(prev => {
                const copy = { ...prev }
                delete copy[order.id]
                return copy
            })
        }
    }

    // Liquidar todas las órdenes pendientes de una tienda a la vez de forma fluida y optimista
    const handleSettleStoreAll = async (storeAccount: any) => {
        const pendingOrders = storeAccount.ordersList.filter((o: Order) => {
            const status = localSettlementStatusOverrides[o.id] || o.settlementStatus
            return status !== 'settled'
        })
        if (pendingOrders.length === 0) return

        // 1. Actualización optimista visual inmediata sin opacar otras tiendas ni bloquear la UI
        const newOverrides: Record<string, 'settled' | 'pending'> = {}
        pendingOrders.forEach((o: Order) => {
            newOverrides[o.id] = 'settled'
        })

        setLocalSettlementStatusOverrides(prev => ({
            ...prev,
            ...newOverrides
        }))

        // 2. Guardar en Firestore en segundo plano
        try {
            const updatePromises = pendingOrders.map((order: Order) =>
                updateDoc(doc(db, 'orders', order.id), {
                    settlementStatus: 'settled'
                })
            )
            await Promise.all(updatePromises)
        } catch (error) {
            console.error("Error liquidando tienda:", error)
            // Revertir si hay error
            setLocalSettlementStatusOverrides(prev => {
                const copy = { ...prev }
                pendingOrders.forEach((o: Order) => {
                    delete copy[o.id]
                })
                return copy
            })
        }
    }

    // Liquidar todas las fechas pendientes de una tienda a la vez (llamada tras confirmación)
    const executeSettleStoreAllDates = async (store: any) => {
        const pendingOrders = store.dates.flatMap((d: any) =>
            d.storeAccount ? d.storeAccount.ordersList.filter((o: Order) => {
                const status = localSettlementStatusOverrides[o.id] || o.settlementStatus
                return status !== 'settled'
            }) : []
        )
        if (pendingOrders.length === 0) return

        setSettling(true)
        // 1. Actualización optimista visual inmediata
        const newOverrides: Record<string, 'settled' | 'pending'> = {}
        pendingOrders.forEach((o: Order) => {
            newOverrides[o.id] = 'settled'
        })

        setLocalSettlementStatusOverrides(prev => ({
            ...prev,
            ...newOverrides
        }))

        // 2. Guardar en Firestore en segundo plano
        try {
            const updatePromises = pendingOrders.map((order: Order) =>
                updateDoc(doc(db, 'orders', order.id), {
                    settlementStatus: 'settled'
                })
            )
            await Promise.all(updatePromises)
        } catch (error) {
            console.error("Error liquidando todas las fechas de tienda:", error)
            // Revertir si hay error
            setLocalSettlementStatusOverrides(prev => {
                const copy = { ...prev }
                pendingOrders.forEach((o: Order) => {
                    delete copy[o.id]
                })
                return copy
            })
        } finally {
            setSettling(false)
        }
    }

    // Liquidar todas las órdenes de un repartidor en un día de forma optimista
    const handleSettleDriverAll = async (driverAccount: any) => {
        const pendingOrders = driverAccount.ordersList.filter((o: Order) => {
            const status = localDeliverySettlementOverrides[o.id] || o.deliverySettlementStatus
            return status !== 'settled'
        })
        if (pendingOrders.length === 0) return

        // Actualización optimista inmediata
        const newOverrides: Record<string, 'settled' | 'pending'> = {}
        pendingOrders.forEach((o: Order) => {
            newOverrides[o.id] = 'settled'
        })

        setLocalDeliverySettlementOverrides(prev => ({
            ...prev,
            ...newOverrides
        }))

        try {
            const updatePromises = pendingOrders.map((order: Order) => {
                const method = order.payment?.method || 'cash'
                const updateData: any = {
                    deliverySettlementStatus: 'settled'
                }
                if (method === 'cash' || method === 'mixed') {
                    updateData['payment.paymentStatus'] = 'paid'
                }
                return updateDoc(doc(db, 'orders', order.id), updateData)
            })
            await Promise.all(updatePromises)
        } catch (error) {
            console.error("Error liquidando repartidor:", error)
            setLocalDeliverySettlementOverrides(prev => {
                const copy = { ...prev }
                pendingOrders.forEach((o: Order) => {
                    delete copy[o.id]
                })
                return copy
            })
        }
    }

    // Liquidar una orden individual de repartidor de forma optimista
    const handleSettleDriverOrder = async (order: Order) => {
        const currentStatus = localDeliverySettlementOverrides[order.id] || order.deliverySettlementStatus
        const newStatus: 'settled' | 'pending' = currentStatus === 'settled' ? 'pending' : 'settled'

        setLocalDeliverySettlementOverrides(prev => ({
            ...prev,
            [order.id]: newStatus
        }))

        try {
            const method = order.payment?.method || 'cash'
            const updateData: any = {
                deliverySettlementStatus: newStatus
            }
            if (newStatus === 'settled' && (method === 'cash' || method === 'mixed')) {
                updateData['payment.paymentStatus'] = 'paid'
            }
            await updateDoc(doc(db, 'orders', order.id), updateData)
        } catch (error) {
            console.error("Error liquidando pedido de repartidor:", error)
            setLocalDeliverySettlementOverrides(prev => {
                const copy = { ...prev }
                delete copy[order.id]
                return copy
            })
        }
    }

    // Alternar suavemente quién recibió el dinero (Fuddi <-> Tienda) sin alertas y con actualización optimista visual inmediata
    const handleTogglePaymentCollector = async (order: Order) => {
        const isPickup = order.delivery?.type === 'pickup'
        const isCash = order.payment?.method === 'cash'
        const currentCollector = localCollectorOverrides[order.id]
            || (order.paymentCollector ? order.paymentCollector : (isPickup && isCash ? 'store' : 'fuddi'))

        const newCollector: 'fuddi' | 'store' = currentCollector === 'store' ? 'fuddi' : 'store'

        // 1. Actualización optimista visual inmediata
        setLocalCollectorOverrides(prev => ({
            ...prev,
            [order.id]: newCollector
        }))

        // 2. Persistir en Firestore en segundo plano
        try {
            const orderRef = doc(db, 'orders', order.id)
            await updateDoc(orderRef, {
                paymentCollector: newCollector
            })
        } catch (error) {
            console.error("Error al actualizar quien recibió el dinero:", error)
        }
    }

    // Adaptador genérico para enviar reportes de WhatsApp para cualquier cuenta
    const handleSendWhatsAppSummaryForAccount = (account: any) => {
        const cel = account.celular || availableDeliveries.find(d => d.id === account.deliveryId)?.celular
        if (!cel) {
            alert("El repartidor no tiene número de celular registrado.")
            return
        }

        const cleanCel = formatWhatsAppPhone(cel)
        if (!cleanCel) {
            alert("El número de celular del repartidor no es válido.")
            return
        }

        const isFullySettled = account.pendingOrderCount === 0
        const targetStatus = isFullySettled ? 'settled' : 'pending'

        const ordersToConsider = (account.ordersList || []).filter((o: Order) => {
            const effectiveStatus = localDeliverySettlementOverrides[o.id] || o.deliverySettlementStatus
            if (targetStatus === 'settled') {
                return effectiveStatus === 'settled'
            } else {
                return effectiveStatus !== 'settled'
            }
        })

        const activeOrdersList = ordersToConsider.length > 0 ? ordersToConsider : (account.ordersList || [])

        let cashCollected = 0
        let feeEarned = 0
        const count = activeOrdersList.length

        activeOrdersList.forEach((o: Order) => {
            const method = o.payment?.method || 'cash'
            const total = o.total || 0
            const deliveryCost = o.delivery?.deliveryCost || 0
            feeEarned += deliveryCost

            if (method === 'cash') {
                cashCollected += total
            } else if (method === 'mixed') {
                cashCollected += (o.payment?.cashAmount || 0)
            }
        })

        const difference = cashCollected - feeEarned
        const entregasLabel = count === 1 ? '1 entrega' : `${count} entregas`

        let message = `Valor cobrado en efectivo: $${formatMoney(cashCollected)}\n` +
            `Delivery (${entregasLabel}): $${formatMoney(feeEarned)}\n\n` +
            `*Diferencia a entregar/recibir:* $${formatMoney(difference)}\n`

        const cashOrders = activeOrdersList.filter((o: Order) => {
            const method = o.payment?.method || 'cash'
            if (method === 'cash') return true
            if (method === 'mixed' && (o.payment?.cashAmount || 0) > 0) return true
            return false
        })

        if (cashOrders.length > 0) {
            message += `\nEfectivo\n`
            cashOrders.forEach((o: Order) => {
                const amount = o.payment?.method === 'mixed' ? (o.payment?.cashAmount || 0) : (o.total || 0)
                const customerName = o.customer?.name || 'Cliente'
                message += `° ${customerName} $${formatMoney(amount)}\n`
            })
        }

        const transferOrders = activeOrdersList.filter((o: Order) => {
            const method = o.payment?.method
            if (method === 'transfer') return true
            if (method === 'mixed' && (o.payment?.transferAmount || 0) > 0) return true
            return false
        })

        if (transferOrders.length > 0) {
            message += `\nTransferencias\n`
            transferOrders.forEach((o: Order) => {
                const amount = o.payment?.method === 'mixed' ? (o.payment?.transferAmount || 0) : (o.total || 0)
                const customerName = o.customer?.name || 'Cliente'
                message += `° ${customerName} $${formatMoney(amount)}\n`
            })
        }

        const encodedText = encodeURIComponent(message.trim())
        const url = `https://wa.me/${cleanCel}?text=${encodedText}`
        window.open(url, '_blank')
    }

    const handleSendWhatsAppSummary = () => {
        if (!selectedAccount) return
        handleSendWhatsAppSummaryForAccount(selectedAccount)
    }

    // Filtrar órdenes canceladas y borradores para "Hoy"
    const activeOrders = useMemo(() => {
        return orders.filter(o => o.status !== 'cancelled' && o.status !== 'borrador')
    }, [orders])

    // Encontrar nombre del negocio seleccionado
    const currentBusinessName = useMemo(() => {
        if (selectedBusinessId === 'all') return 'Todas las tiendas'
        const biz = businesses.find(b => b.id === selectedBusinessId)
        return biz ? biz.name : 'Tienda seleccionada'
    }, [selectedBusinessId, businesses])

    // Totales globales para "Hoy"
    const globalTotals = useMemo(() => {
        let pendingCash = 0
        let pendingTransfer = 0
        let pendingDeliveriesFee = 0
        let pendingCount = 0

        let settledCash = 0
        let settledTransfer = 0
        let settledDeliveriesFee = 0
        let settledCount = 0

        activeOrders.forEach(o => {
            const isSettled = o.deliverySettlementStatus === 'settled'
            const method = o.payment?.method || 'cash'
            const total = o.total || 0

            let orderCash = 0
            let orderTransfer = 0

            if (method === 'cash') {
                orderCash = total
            } else if (method === 'transfer') {
                orderTransfer = total
            } else if (method === 'mixed') {
                orderCash = o.payment?.cashAmount || 0
                orderTransfer = o.payment?.transferAmount || 0
            }

            const orderDeliveryFee = o.delivery?.type === 'delivery' ? (o.delivery?.deliveryCost || 0) : 0

            if (isSettled) {
                settledCount++
                settledCash += orderCash
                settledTransfer += orderTransfer
                settledDeliveriesFee += orderDeliveryFee
            } else {
                pendingCount++
                pendingCash += orderCash
                pendingTransfer += orderTransfer
                pendingDeliveriesFee += orderDeliveryFee
            }
        })

        return {
            pendingCash,
            pendingTransfer,
            pendingDeliveriesFee,
            pendingCount,
            settledCash,
            settledTransfer,
            settledDeliveriesFee,
            settledCount,
            totalCount: pendingCount + settledCount
        }
    }, [activeOrders])

    // Repartidores de hoy
    const deliveryAccounts = useMemo(() => {
        return calculateDeliveryAccounts(activeOrders, availableDeliveries, localDeliverySettlementOverrides)
    }, [activeOrders, availableDeliveries, localDeliverySettlementOverrides])

    // Agrupación de cierres de repartidores por fecha de programación
    const deliveryDaysGrouped = useMemo(() => {
        const todayStr = getLocalDateString(new Date())
        const allOrdersList = Array.from(
            new Map([...historyOrders, ...orders].map(o => [o.id, o])).values()
        ).filter(o => o.status !== 'cancelled' && o.status !== 'borrador' && o.delivery?.type === 'delivery')

        const groups: Record<string, Order[]> = {}
        allOrdersList.forEach(o => {
            const refDate = getOrderReferenceDate(o)
            const dateStr = getLocalDateString(refDate)
            if (!groups[dateStr]) {
                groups[dateStr] = []
            }
            groups[dateStr].push(o)
        })

        return Object.entries(groups).map(([dateStr, ordersList]) => {
            const [y, m, d] = dateStr.split('-').map(Number)
            const date = new Date(y, m - 1, d, 12, 0, 0)
            const isToday = dateStr === todayStr

            let displayDate = ''
            if (isToday) {
                displayDate = `Hoy (${date.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })})`
            } else {
                const formatted = date.toLocaleDateString('es-EC', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                })
                displayDate = formatted.charAt(0).toUpperCase() + formatted.slice(1)
            }

            const deliveryAccountsList = calculateDeliveryAccounts(ordersList, availableDeliveries, localDeliverySettlementOverrides).sort((a, b) => {
                const aIsPending = a.pendingOrderCount > 0 ? 0 : 1
                const bIsPending = b.pendingOrderCount > 0 ? 0 : 1
                return aIsPending - bIsPending
            })
            const pendingDriversCount = deliveryAccountsList.filter(d => d.pendingOrderCount > 0).length
            const totalDriversCount = deliveryAccountsList.length
            const settledDriversCount = totalDriversCount - pendingDriversCount
            const isDayFullySettled = totalDriversCount > 0 && pendingDriversCount === 0

            return {
                dateStr,
                displayDate,
                date,
                isToday,
                ordersList,
                deliveryAccounts: deliveryAccountsList,
                pendingDriversCount,
                totalDriversCount,
                settledDriversCount,
                isDayFullySettled
            }
        }).sort((a, b) => b.dateStr.localeCompare(a.dateStr))
    }, [orders, historyOrders, availableDeliveries, localDeliverySettlementOverrides])

    // Días de repartidores filtrados por Pendientes / Historial
    const filteredDeliveryDays = useMemo(() => {
        if (deliverySubTab === 'pending') {
            return deliveryDaysGrouped.filter(day => !day.isDayFullySettled && day.pendingDriversCount > 0)
        }
        return deliveryDaysGrouped
    }, [deliveryDaysGrouped, deliverySubTab])

    // Restaurantes de hoy
    const storeAccounts = useMemo(() => {
        return calculateStoreAccounts(activeOrders, businesses || [], localCollectorOverrides, localSettlementStatusOverrides)
    }, [activeOrders, businesses, localCollectorOverrides, localSettlementStatusOverrides])

    // Agrupación de cierres de restaurantes por negocio (Restaurante -> Fechas)
    const storeAccountsGrouped = useMemo(() => {
        const todayStr = getLocalDateString(new Date())
        const allOrdersList = Array.from(
            new Map([...historyOrders, ...orders].map(o => [o.id, o])).values()
        ).filter(o => o.status !== 'cancelled' && o.status !== 'borrador')

        const ordersByBusiness: Record<string, Order[]> = {}
        allOrdersList.forEach(o => {
            if (!o.businessId) return
            if (!ordersByBusiness[o.businessId]) {
                ordersByBusiness[o.businessId] = []
            }
            ordersByBusiness[o.businessId].push(o)
        })

        return Object.entries(ordersByBusiness).map(([businessId, bizOrders]) => {
            const businessInfo = businesses?.find(b => b.id === businessId)
            const businessName = businessInfo?.name || (bizOrders[0] as any).businessName || `Restaurante ${businessId.substring(0, 6)}...`

            const dateGroups: Record<string, Order[]> = {}
            bizOrders.forEach(o => {
                const refDate = getOrderReferenceDate(o)
                const dateStr = getLocalDateString(refDate)
                if (!dateGroups[dateStr]) {
                    dateGroups[dateStr] = []
                }
                dateGroups[dateStr].push(o)
            })

            const datesList = Object.entries(dateGroups).map(([dateStr, ordersList]) => {
                const [y, m, d] = dateStr.split('-').map(Number)
                const date = new Date(y, m - 1, d, 12, 0, 0)
                const isToday = dateStr === todayStr

                let displayDate = ''
                if (isToday) {
                    displayDate = `Hoy (${date.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })})`
                } else {
                    const formatted = date.toLocaleDateString('es-EC', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                    })
                    displayDate = formatted.charAt(0).toUpperCase() + formatted.slice(1)
                }

                const storeAccountsList = calculateStoreAccounts(ordersList, businesses || [], localCollectorOverrides, localSettlementStatusOverrides)
                const storeAccount = storeAccountsList[0]

                return {
                    dateStr,
                    displayDate,
                    date,
                    isToday,
                    ordersList,
                    storeAccount
                }
            }).sort((a, b) => b.dateStr.localeCompare(a.dateStr))

            const pendingDates = datesList.filter(d => d.storeAccount && d.storeAccount.pendingOrderCount > 0)
            const pendingNetBalance = pendingDates.reduce((sum, d) => sum + (d.storeAccount?.netBalance || 0), 0)
            const pendingDatesCount = pendingDates.length
            const totalDatesCount = datesList.length
            const settledDatesCount = totalDatesCount - pendingDatesCount
            const isFullySettled = totalDatesCount > 0 && pendingDatesCount === 0

            return {
                businessId,
                name: businessName,
                dates: datesList,
                pendingNetBalance,
                pendingDatesCount,
                totalDatesCount,
                settledDatesCount,
                isFullySettled
            }
        }).sort((a, b) => {
            const aIsPending = a.pendingDatesCount > 0 ? 0 : 1
            const bIsPending = b.pendingDatesCount > 0 ? 0 : 1
            if (aIsPending !== bIsPending) return aIsPending - bIsPending
            return a.name.localeCompare(b.name)
        })
    }, [orders, historyOrders, businesses, localCollectorOverrides, localSettlementStatusOverrides])

    // Filtrar restaurantes y sus fechas según la subpestaña seleccionada (Pendientes / Historial)
    const filteredStoreGroups = useMemo(() => {
        if (restaurantSubTab === 'pending') {
            return storeAccountsGrouped
                .map(store => {
                    const pendingDates = store.dates.filter(d => d.storeAccount && d.storeAccount.pendingOrderCount > 0)
                    return {
                        ...store,
                        dates: pendingDates
                    }
                })
                .filter(store => store.dates.length > 0)
        }
        return storeAccountsGrouped
    }, [storeAccountsGrouped, restaurantSubTab])

    const pendingStoresCountGlobal = useMemo(() => {
        return storeAccountsGrouped.filter(s => !s.isFullySettled && s.pendingDatesCount > 0).length
    }, [storeAccountsGrouped])

    const totalStoresCountGlobal = useMemo(() => {
        return storeAccountsGrouped.length
    }, [storeAccountsGrouped])

    const todayStoreGroups = useMemo(() => {
        return filteredStoreGroups.filter(store => store.dates.some(d => d.isToday))
    }, [filteredStoreGroups])

    const previousStoreGroups = useMemo(() => {
        return filteredStoreGroups.filter(store => !store.dates.some(d => d.isToday))
    }, [filteredStoreGroups])

    // Cuenta del restaurante seleccionado hoy
    const selectedStoreAccount = useMemo(() => {
        if (selectedStoreId === 'all') return null
        return storeAccounts.find(s => s.businessId === selectedStoreId) || null
    }, [storeAccounts, selectedStoreId])

    // Cuenta del repartidor seleccionado hoy
    const selectedAccount = useMemo(() => {
        if (selectedDeliveryId === 'all') return null
        return deliveryAccounts.find(acc => acc.deliveryId === selectedDeliveryId) || null
    }, [deliveryAccounts, selectedDeliveryId])

    // Órdenes del repartidor de hoy filtradas por tienda
    const filteredOrdersByStore = useMemo(() => {
        if (!selectedAccount) return []
        if (selectedStoreFilterId === 'all') return selectedAccount.ordersList
        return selectedAccount.ordersList.filter(o => o.businessId === selectedStoreFilterId)
    }, [selectedAccount, selectedStoreFilterId])

    // Agrupar órdenes del repartidor de hoy por método de pago
    const groupedOrders = useMemo(() => {
        const groups: { cash: Order[], transfer: Order[], mixed: Order[] } = {
            cash: [],
            transfer: [],
            mixed: []
        }
        filteredOrdersByStore.forEach(order => {
            const method = order.payment?.method || 'cash'
            if (method === 'cash') {
                groups.cash.push(order)
            } else if (method === 'transfer') {
                groups.transfer.push(order)
            } else if (method === 'mixed') {
                groups.mixed.push(order)
            }
        })
        return groups
    }, [filteredOrdersByStore])

    // Tiendas únicas con entregas para el repartidor seleccionado hoy
    const driverStores = useMemo(() => {
        if (!selectedAccount || !selectedAccount.ordersList) return []
        
        const storeIds = new Set<string>()
        selectedAccount.ordersList.forEach(order => {
            if (order.businessId) {
                storeIds.add(order.businessId)
            }
        })

        const storesList: { id: string; name: string; image: string | undefined }[] = []
        storeIds.forEach(id => {
            const biz = businesses.find(b => b.id === id)
            if (biz) {
                storesList.push({
                    id: biz.id,
                    name: biz.name || 'Tienda',
                    image: biz.image
                })
            } else {
                storesList.push({
                    id,
                    name: 'Tienda',
                    image: undefined
                })
            }
        })

        return storesList
    }, [selectedAccount, businesses])

    // --- LOGICA Y PROCESAMIENTO DEL HISTORIAL ---

    // Agrupar órdenes del historial por día (excluyendo hoy)
    const groupedHistoryDays = useMemo(() => {
        const activeHistoryOrders = historyOrders.filter(o => o.status !== 'cancelled' && o.status !== 'borrador')
        const todayStr = getLocalDateString(new Date())

        const groups: Record<string, Order[]> = {}
        activeHistoryOrders.forEach(o => {
            const refDate = getOrderReferenceDate(o)
            const dateStr = getLocalDateString(refDate)
            
            if (dateStr === todayStr) return // Excluir hoy ya que está en la pestaña "Hoy"

            if (!groups[dateStr]) {
                groups[dateStr] = []
            }
            groups[dateStr].push(o)
        })

        return Object.entries(groups).map(([dateStr, ordersList]) => {
            const date = new Date(dateStr + 'T12:00:00')
            const formattedDate = date.toLocaleDateString('es-EC', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })
            const displayDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1)

            const deliveryOrders = ordersList.filter(o => o.delivery?.type === 'delivery')
            // Está liquidado si tiene envíos y todos están liquidados
            const isSettled = deliveryOrders.length > 0 && deliveryOrders.every(o => o.deliverySettlementStatus === 'settled')

            let totalCash = 0
            let totalFee = 0
            ordersList.forEach(o => {
                if (o.delivery?.type !== 'delivery') return
                const method = o.payment?.method || 'cash'
                const total = o.total || 0
                const fee = o.delivery?.deliveryCost || 0
                
                totalFee += fee
                if (method === 'cash') {
                    totalCash += total
                } else if (method === 'mixed') {
                    totalCash += o.payment?.cashAmount || 0
                }
            })
            const netCash = totalCash - totalFee

            return {
                dateStr,
                displayDate,
                ordersList,
                isSettled,
                totalCash,
                totalFee,
                netCash,
                deliveryOrdersCount: deliveryOrders.length
            }
        }).sort((a, b) => b.dateStr.localeCompare(a.dateStr))
    }, [historyOrders])

    // Cuenta del repartidor seleccionado del historial
    const selectedHistoryAccount = useMemo(() => {
        if (!selectedHistoryDelivery) return null
        const day = groupedHistoryDays.find(d => d.dateStr === selectedHistoryDelivery.dateStr)
        if (!day) return null
        const dayAccounts = calculateDeliveryAccounts(day.ordersList, availableDeliveries)
        return dayAccounts.find(acc => acc.deliveryId === selectedHistoryDelivery.deliveryId) || null
    }, [selectedHistoryDelivery, groupedHistoryDays, availableDeliveries])

    // Órdenes del repartidor del historial filtradas por tienda
    const filteredHistoryOrdersByStore = useMemo(() => {
        if (!selectedHistoryAccount) return []
        if (selectedHistoryStoreFilterId === 'all') return selectedHistoryAccount.ordersList
        return selectedHistoryAccount.ordersList.filter(o => o.businessId === selectedHistoryStoreFilterId)
    }, [selectedHistoryAccount, selectedHistoryStoreFilterId])

    // Agrupar órdenes del repartidor del historial por método de pago
    const groupedHistoryOrders = useMemo(() => {
        const groups: { cash: Order[], transfer: Order[], mixed: Order[] } = {
            cash: [],
            transfer: [],
            mixed: []
        }
        filteredHistoryOrdersByStore.forEach(order => {
            const method = order.payment?.method || 'cash'
            if (method === 'cash') {
                groups.cash.push(order)
            } else if (method === 'transfer') {
                groups.transfer.push(order)
            } else if (method === 'mixed') {
                groups.mixed.push(order)
            }
        })
        return groups
    }, [filteredHistoryOrdersByStore])

    // Tiendas únicas del repartidor en la fecha seleccionada del historial
    const historyDriverStores = useMemo(() => {
        if (!selectedHistoryAccount || !selectedHistoryAccount.ordersList) return []
        
        const storeIds = new Set<string>()
        selectedHistoryAccount.ordersList.forEach(order => {
            if (order.businessId) {
                storeIds.add(order.businessId)
            }
        })

        const storesList: { id: string; name: string; image: string | undefined }[] = []
        storeIds.forEach(id => {
            const biz = businesses.find(b => b.id === id)
            if (biz) {
                storesList.push({
                    id: biz.id,
                    name: biz.name || 'Tienda',
                    image: biz.image
                })
            } else {
                storesList.push({
                    id,
                    name: 'Tienda',
                    image: undefined
                })
            }
        })

        return storesList
    }, [selectedHistoryAccount, businesses])

    const toggleGroup = (group: 'cash' | 'transfer' | 'mixed') => {
        setCollapsedGroups(prev => ({
            ...prev,
            [group]: !prev[group]
        }))
    }

    const renderOrderGroup = (
        title: string,
        groupKey: 'cash' | 'transfer' | 'mixed',
        ordersList: Order[],
        icon: string,
        colorClass: string
    ) => {
        if (ordersList.length === 0) return null

        const isCollapsed = collapsedGroups[groupKey]

        return (
            <div className="space-y-2 border border-gray-100 bg-white rounded-2xl p-3 shadow-sm animate-in fade-in duration-200">
                {/* Group Header */}
                <button
                    onClick={() => toggleGroup(groupKey)}
                    className="w-full flex items-center justify-between font-bold text-xs text-gray-700 py-1"
                >
                    <div className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-lg ${colorClass} flex items-center justify-center shrink-0`}>
                            <i className={`bi ${icon} text-xs`}></i>
                        </div>
                        <span>{title} ({ordersList.length})</span>
                    </div>
                    <i className={`bi bi-chevron-${isCollapsed ? 'right' : 'down'} text-gray-400 text-[10px]`}></i>
                </button>

                {/* Group Body */}
                {!isCollapsed && (
                    <div className="space-y-2 pt-2 border-t border-gray-50 animate-in fade-in duration-200">
                        {ordersList.map(order => {
                            const deliveryCost = order.delivery?.deliveryCost || 0
                            const total = order.total || 0
                            const method = order.payment?.method || 'cash'

                            return (
                                <div key={order.id} className="bg-gray-50 p-3 rounded-xl border border-gray-100/50 space-y-2 text-xs">
                                    <div className="flex justify-between items-center font-bold">
                                        <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                            <span className="text-gray-900 truncate">{order.customer?.name}</span>
                                            {order.deliverySettlementStatus === 'settled' ? (
                                                <span className="px-1 py-0.5 text-[8px] font-black uppercase tracking-wider bg-green-100 text-green-700 rounded shrink-0">Liq</span>
                                            ) : (
                                                <span className="px-1 py-0.5 text-[8px] font-black uppercase tracking-wider bg-gray-200 text-gray-600 rounded shrink-0">Pend</span>
                                            )}
                                        </div>
                                        <span className="text-gray-400 text-[10px] shrink-0">{getOrderDisplayTime(order)}</span>
                                    </div>
                                    
                                    <div className="flex justify-between items-center text-gray-600">
                                        <button
                                            onClick={() => onManagePayment(order)}
                                            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all border border-transparent shadow-[0_1px_2px_rgba(0,0,0,0.02)] active:scale-95 ${
                                                order.payment?.paymentStatus === 'paid'
                                                    ? 'bg-green-50 text-green-700 hover:bg-green-100'
                                                    : order.payment?.paymentStatus === 'validating'
                                                        ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                                                        : 'bg-red-50 text-red-700 hover:bg-red-100'
                                            }`}
                                            title="Administrar Pago"
                                        >
                                            <i className={`bi ${
                                                method === 'transfer' ? 'bi-bank' :
                                                method === 'mixed' ? 'bi-cash-coin' : 'bi-cash'
                                            } text-xs`}></i>
                                            <span className="font-extrabold">${total.toFixed(2)}</span>
                                            <i className="bi bi-pencil-square text-[9px] opacity-60 ml-0.5"></i>
                                        </button>
                                        <span className="text-orange-600 font-semibold">Envío: ${deliveryCost.toFixed(2)}</span>
                                    </div>

                                    {method === 'mixed' && (
                                        <div className="flex justify-between items-center pt-1 border-t border-gray-55 text-[9px] font-semibold text-gray-400">
                                            <span>Efectivo: ${order.payment?.cashAmount?.toFixed(2) || '0.00'}</span>
                                            <span>Transf: ${order.payment?.transferAmount?.toFixed(2) || '0.00'}</span>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        )
    }

    const renderStoreCard = (store: any) => {
        const isStoreExpanded = Boolean(expandedRestaurants[store.businessId])

        return (
            <div key={store.businessId} className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden transition-all animate-in fade-in duration-150">
                {/* Cabecera del Restaurante (Colapsada por defecto) */}
                <div
                    onClick={() => toggleRestaurantExpand(store.businessId)}
                    className="p-4 hover:bg-slate-50/60 transition-colors cursor-pointer flex flex-wrap items-center justify-between gap-3 select-none"
                >
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-sm text-slate-900 leading-tight">{store.name}</h4>
                            <span className="text-[10px] font-semibold text-slate-400">
                                ({store.dates.length} {store.dates.length === 1 ? 'fecha' : 'fechas'})
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                        {store.isFullySettled ? (
                            <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center gap-1.5 shadow-2xs">
                                <div className="w-3.5 h-3.5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[8px] font-black">
                                    ✓
                                </div>
                                <span>Todo depositado</span>
                            </span>
                        ) : (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setStoreToSettle(store)
                                }}
                                disabled={settling}
                                className={`px-2.5 py-1 rounded-lg font-bold text-[10px] flex items-center gap-1 text-white shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50 ${
                                    store.pendingNetBalance >= 0
                                        ? 'bg-emerald-600 hover:bg-emerald-700'
                                        : 'bg-amber-600 hover:bg-amber-700'
                                }`}
                                title={`Liquidar todo lo pendiente de ${store.name}`}
                            >
                                <i className="bi bi-check2-all text-xs"></i>
                                <span>
                                    {store.pendingNetBalance >= 0
                                        ? `Transferir $${store.pendingNetBalance.toFixed(2)}`
                                        : `Cobrar $${Math.abs(store.pendingNetBalance).toFixed(2)}`
                                    }
                                </span>
                            </button>
                        )}
                        <i className={`bi bi-chevron-${isStoreExpanded ? 'up' : 'down'} text-slate-400 text-xs ml-1`}></i>
                    </div>
                </div>

                {/* Subagrupación por Fecha dentro del Restaurante */}
                {isStoreExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-3 space-y-3 animate-in fade-in duration-150">
                        {store.dates.map((day: any) => {
                            const dateKey = `${store.businessId}_${day.dateStr}`
                            const isDayExpanded = Boolean(expandedRestaurantDays[dateKey])
                            const isPositive = day.storeAccount.netBalance >= 0

                            return (
                                <div key={day.dateStr} className="bg-white rounded-xl border border-slate-200/80 shadow-2xs overflow-hidden">
                                    {/* Cabecera de la Fecha */}
                                    <div
                                        onClick={() => toggleRestaurantDayExpand(dateKey)}
                                        className="p-3.5 hover:bg-slate-50/50 transition-colors cursor-pointer flex justify-between items-center select-none"
                                    >
                                        <div>
                                            <h4 className="font-bold text-sm text-slate-900">{day.displayDate}</h4>
                                            <p className="text-xs text-slate-500 mt-0.5">{day.storeAccount.orderCount} {day.storeAccount.orderCount === 1 ? 'orden' : 'órdenes'}</p>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {day.storeAccount.pendingOrderCount > 0 ? (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleSettleStoreAll(day.storeAccount)
                                                    }}
                                                    disabled={settling}
                                                    className={`px-2.5 py-1 rounded-lg font-bold text-[11px] flex items-center gap-1 text-white shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50 ${
                                                        isPositive
                                                            ? 'bg-emerald-600 hover:bg-emerald-700'
                                                            : 'bg-amber-600 hover:bg-amber-700'
                                                    }`}
                                                    title={`Liquidar todas las órdenes del día de ${store.name}`}
                                                >
                                                    <i className="bi bi-check2-all text-xs"></i>
                                                    <span>
                                                        {isPositive
                                                            ? `Transferir $${day.storeAccount.netBalance.toFixed(2)}`
                                                            : `Cobrar $${Math.abs(day.storeAccount.netBalance).toFixed(2)}`
                                                        }
                                                    </span>
                                                </button>
                                            ) : (
                                                <span className={`px-2.5 py-1 text-[10px] font-bold rounded-full flex items-center gap-1 border ${
                                                    isPositive
                                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                                                        : 'bg-amber-50 text-amber-700 border-amber-200/60'
                                                }`}>
                                                    <i className="bi bi-check-circle-fill text-[10px]"></i>
                                                    <span>Liquidado ${Math.abs(day.storeAccount.netBalance).toFixed(2)}</span>
                                                </span>
                                            )}
                                            <i className={`bi bi-chevron-${isDayExpanded ? 'up' : 'down'} text-slate-400 text-xs ml-0.5`}></i>
                                        </div>
                                    </div>

                                    {/* Detalle de Órdenes en esta Fecha */}
                                    {isDayExpanded && (
                                        <div className="border-t border-slate-100 p-3 bg-slate-50/30 space-y-3 animate-in fade-in duration-150">
                                            {/* Resumen de Totales Fuddi, Tienda, Comisión en el cuerpo desplegable */}
                                            <div className="grid grid-cols-3 gap-2 bg-white p-2.5 rounded-xl text-center border border-slate-200/60 shadow-2xs text-xs">
                                                <div>
                                                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Fuddi</p>
                                                    <p className="font-bold text-slate-900 mt-0.5">${day.storeAccount.digitalCollected.toFixed(2)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Tienda</p>
                                                    <p className="font-bold text-slate-900 mt-0.5">${day.storeAccount.cashCollected.toFixed(2)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Comisión</p>
                                                    <p className="font-bold text-slate-500 mt-0.5">-${day.storeAccount.commission.toFixed(2)}</p>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                {day.storeAccount.ordersList.map((order: Order) => {
                                                    const isPickup = order.delivery?.type === 'pickup'
                                                    const isCash = order.payment?.method === 'cash'
                                                    const effectiveCollector = localCollectorOverrides[order.id]
                                                        || (order.paymentCollector ? order.paymentCollector : (isPickup && isCash ? 'store' : 'fuddi'))
                                                    const isStoreMoney = effectiveCollector === 'store'
                                                    const isSettled = (localSettlementStatusOverrides[order.id] ? localSettlementStatusOverrides[order.id] === 'settled' : order.settlementStatus === 'settled')
                                                    const orderTotal = order.total || 0

                                                    let orderCommission = 0
                                                    if (order.items && order.items.length > 0) {
                                                        order.items.forEach((item: any) => {
                                                            orderCommission += (item.commission || 0) * (item.quantity || 1)
                                                        })
                                                    }

                                                    const deliveryFee = order.delivery?.type === 'delivery' ? (order.delivery?.deliveryCost || 0) : 0
                                                    const productSubtotal = order.subtotal || Math.max(0, orderTotal - deliveryFee)

                                                    return (
                                                        <div key={order.id} className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-2xs space-y-2 text-xs">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                                                    <span className="font-bold text-slate-900">{order.customer?.name || 'Cliente'}</span>
                                                                    <span className="text-slate-400 text-[10px]">({getOrderDisplayTime(order)} • {isCash ? 'Efectivo' : 'Transferencia'})</span>
                                                                </div>

                                                                <div className="flex items-center gap-1.5 shrink-0">
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            handleTogglePaymentCollector(order)
                                                                        }}
                                                                        title="Haz clic para alternar quien recibió el dinero (Tienda / Fuddi)"
                                                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all active:scale-95 cursor-pointer select-none border ${
                                                                            isStoreMoney
                                                                                ? 'bg-purple-100 text-purple-800 hover:bg-purple-200 border-purple-200/60'
                                                                                : 'bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200/60'
                                                                        }`}
                                                                    >
                                                                        {isStoreMoney ? '🏢 Tienda' : '🦅 Fuddi'}
                                                                    </button>

                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            handleSettleStoreOrder(order)
                                                                        }}
                                                                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 shadow-2xs active:scale-95 cursor-pointer border ${
                                                                            isSettled
                                                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60 hover:bg-red-50 hover:text-red-700 hover:border-red-200'
                                                                                : 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent'
                                                                        }`}
                                                                        title={isSettled ? "Hacer clic para deshacer liquidación" : "Marcar este pedido como liquidado/depositado"}
                                                                    >
                                                                        <i className={`bi ${isSettled ? 'bi-check-circle-fill' : 'bi-check2'} text-[10px]`}></i>
                                                                        <span>{isSettled ? 'Depositado' : 'Liquidar'}</span>
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-slate-600 text-xs">
                                                                <div className="flex items-center gap-3">
                                                                    <span>Venta: <strong className="text-slate-900">${productSubtotal.toFixed(2)}</strong></span>
                                                                    <span className="text-slate-400">Comisión: <strong className="text-slate-500">-${orderCommission.toFixed(2)}</strong></span>
                                                                </div>

                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        onManagePayment(order)
                                                                    }}
                                                                    className="px-2 py-0.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1 shadow-2xs"
                                                                >
                                                                    <i className="bi bi-pencil text-[10px]"></i>
                                                                    <span>Gestionar</span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50">
            {/* Cierre Header inside sidebar */}
            <div className="px-4 py-3 bg-white border-b border-gray-100 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        onClick={onBack}
                        className="p-1 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors flex items-center shrink-0"
                        title="Volver"
                    >
                        <i className="bi bi-chevron-left text-lg"></i>
                    </button>
                    <div className="min-w-0">
                        <h2 className="text-base font-bold text-gray-900 leading-tight truncate">Cierre de Caja</h2>
                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider truncate">{currentBusinessName}</p>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                            title="Cerrar"
                        >
                            <i className="bi bi-x-lg text-lg"></i>
                        </button>
                    )}
                </div>
            </div>

            {/* Selector de entidad: Deliverys / Restaurantes */}
            {selectedDeliveryId === 'all' && !selectedHistoryDelivery && (
                <div className="px-4 py-2 bg-white border-b border-gray-100 shrink-0">
                    <div className="flex gap-2">
                        <button
                            onClick={() => setEntityType('deliveries')}
                            className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-xl border transition-all flex items-center justify-center gap-1.5 ${
                                entityType === 'deliveries'
                                    ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                        >
                            <i className="bi bi-scooter text-xs"></i>
                            <span>Deliverys</span>
                        </button>
                        <button
                            onClick={() => setEntityType('restaurants')}
                            className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-xl border transition-all flex items-center justify-center gap-1.5 ${
                                entityType === 'restaurants'
                                    ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                        >
                            <i className="bi bi-shop text-xs"></i>
                            <span>Restaurantes</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Scrollable View Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {selectedDeliveryId === 'all' ? (
                        entityType === 'restaurants' ? (
                            selectedStoreId !== 'all' && selectedStoreAccount ? (
                                /* Vista Detallada Minimalista de un Restaurante */
                                <div className="space-y-4 animate-in fade-in duration-150">
                                    {/* Tarjeta Resumen Minimalista */}
                                    <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs space-y-3">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h4 className="font-bold text-base text-slate-900">{selectedStoreAccount.name}</h4>
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    {selectedStoreAccount.orderCount} {selectedStoreAccount.orderCount === 1 ? 'orden hoy' : 'órdenes hoy'}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => setSelectedStoreId('all')}
                                                className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors shrink-0"
                                            >
                                                Ver todos
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl text-center border border-slate-100">
                                            <div>
                                                <p className="text-[10px] font-medium text-slate-500">Fuddi</p>
                                                <p className="text-xs font-semibold text-slate-900 mt-0.5">${selectedStoreAccount.digitalCollected.toFixed(2)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-medium text-slate-500">Tienda</p>
                                                <p className="text-xs font-semibold text-slate-900 mt-0.5">${selectedStoreAccount.cashCollected.toFixed(2)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-medium text-slate-500">Comisión</p>
                                                <p className="text-xs font-semibold text-slate-500 mt-0.5">-${selectedStoreAccount.commission.toFixed(2)}</p>
                                            </div>
                                        </div>

                                        <div className="pt-1">
                                             {selectedStoreAccount.pendingOrderCount > 0 ? (
                                                 <button
                                                     type="button"
                                                     onClick={() => handleSettleStoreAll(selectedStoreAccount)}
                                                     disabled={settling}
                                                     className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 text-white shadow-2xs transition-all active:scale-[0.99] cursor-pointer disabled:opacity-50 ${
                                                         selectedStoreAccount.netBalance >= 0
                                                             ? 'bg-emerald-600 hover:bg-emerald-700'
                                                             : 'bg-amber-600 hover:bg-amber-700'
                                                     }`}
                                                 >
                                                     <i className="bi bi-check2-all text-base"></i>
                                                     <span>
                                                         {selectedStoreAccount.netBalance >= 0
                                                             ? `Transferir $${selectedStoreAccount.netBalance.toFixed(2)}`
                                                             : `Cobrar $${Math.abs(selectedStoreAccount.netBalance).toFixed(2)}`
                                                         }
                                                     </span>
                                                 </button>
                                             ) : (
                                                 <div className={`w-full py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border ${
                                                     selectedStoreAccount.netBalance >= 0
                                                         ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                                                         : 'bg-amber-50 text-amber-700 border-amber-200/60'
                                                 }`}>
                                                     <i className="bi bi-check-circle-fill text-sm"></i>
                                                     <span>Liquidado ${Math.abs(selectedStoreAccount.netBalance).toFixed(2)}</span>
                                                 </div>
                                             )}
                                         </div>
                                    </div>

                                    {/* Lista Minimalista de Órdenes */}
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Órdenes</h4>
                                        {selectedStoreAccount.ordersList.map(order => {
                                            const isPickup = order.delivery?.type === 'pickup'
                                            const isCash = order.payment?.method === 'cash'
                                            const effectiveCollector = localCollectorOverrides[order.id]
                                                || (order.paymentCollector ? order.paymentCollector : (isPickup && isCash ? 'store' : 'fuddi'))
                                            const isStoreMoney = effectiveCollector === 'store'
                                            const isSettled = order.settlementStatus === 'settled'
                                            const orderTotal = order.total || 0

                                            let orderCommission = 0
                                            if (order.items && order.items.length > 0) {
                                                order.items.forEach((item: any) => {
                                                    orderCommission += (item.commission || 0) * (item.quantity || 1)
                                                })
                                            }

                                            const deliveryFee = order.delivery?.type === 'delivery' ? (order.delivery?.deliveryCost || 0) : 0
                                            const productSubtotal = order.subtotal || Math.max(0, orderTotal - deliveryFee)

                                            return (
                                                <div key={order.id} className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs space-y-2.5 text-xs">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                                            <span className="font-bold text-slate-900 text-sm">{order.customer?.name || 'Cliente'}</span>
                                                            <span className="text-slate-400 text-[10px]">({getOrderDisplayTime(order)} • {isCash ? 'Efectivo' : 'Transferencia'})</span>
                                                        </div>

                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    handleTogglePaymentCollector(order)
                                                                }}
                                                                title="Haz clic para alternar quien recibió el dinero (Tienda / Fuddi)"
                                                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all active:scale-95 cursor-pointer select-none border ${
                                                                    isStoreMoney
                                                                        ? 'bg-purple-100 text-purple-800 hover:bg-purple-200 border-purple-200/60'
                                                                        : 'bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200/60'
                                                                }`}
                                                            >
                                                                {isStoreMoney ? '🏢 Tienda' : '🦅 Fuddi'}
                                                            </button>

                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    handleSettleStoreOrder(order)
                                                                }}
                                                                disabled={settling}
                                                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 shadow-2xs active:scale-95 cursor-pointer disabled:opacity-50 border ${
                                                                    isSettled
                                                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60 hover:bg-red-50 hover:text-red-700 hover:border-red-200'
                                                                        : 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent'
                                                                }`}
                                                                title={isSettled ? "Hacer clic para deshacer liquidación" : "Marcar este pedido como liquidado/depositado"}
                                                            >
                                                                <i className={`bi ${isSettled ? 'bi-check-circle-fill' : 'bi-check2'} text-[10px]`}></i>
                                                                <span>{isSettled ? 'Depositado' : 'Liquidar'}</span>
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-slate-600 text-xs">
                                                        <div className="flex items-center gap-3">
                                                            <span>Venta: <strong className="text-slate-900">${productSubtotal.toFixed(2)}</strong></span>
                                                            <span className="text-slate-400">Comisión: <strong className="text-slate-500">-${orderCommission.toFixed(2)}</strong></span>
                                                        </div>

                                                        <button
                                                            onClick={() => onManagePayment(order)}
                                                            className="px-2 py-0.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1 shadow-2xs"
                                                        >
                                                            <i className="bi bi-pencil text-[10px]"></i>
                                                            <span>Gestionar</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            ) : (
                                /* Lista de Cierre de Restaurantes Agrupada por Restaurante y Subagrupada por Fecha */
                                <div className="space-y-3">
                                    {/* Selector de subpestañas Pendientes / Historial para Restaurantes */}
                                    <div className="flex bg-slate-200/60 p-1 rounded-xl shadow-2xs border border-slate-200/40 text-xs">
                                        <button
                                            type="button"
                                            onClick={() => setRestaurantSubTab('pending')}
                                            className={`flex-1 py-1.5 px-3 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer ${
                                                restaurantSubTab === 'pending'
                                                    ? 'bg-white text-slate-900 shadow-2xs font-black'
                                                    : 'text-slate-500 hover:text-slate-800'
                                            }`}
                                        >
                                            <span>Pendientes</span>
                                            {pendingStoresCountGlobal > 0 && (
                                                <span className="px-1.5 py-0.2 text-[9px] font-black rounded-full bg-amber-500 text-white shadow-2xs">
                                                    {pendingStoresCountGlobal}
                                                </span>
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setRestaurantSubTab('history')}
                                            className={`flex-1 py-1.5 px-3 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer ${
                                                restaurantSubTab === 'history'
                                                    ? 'bg-white text-slate-900 shadow-2xs font-black'
                                                    : 'text-slate-500 hover:text-slate-800'
                                            }`}
                                        >
                                            <span>Historial</span>
                                            <span className="px-1.5 py-0.2 text-[9px] font-semibold rounded-full bg-slate-200 text-slate-700">
                                                {totalStoresCountGlobal}
                                            </span>
                                        </button>
                                    </div>

                                    {filteredStoreGroups.length === 0 ? (
                                        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 text-center space-y-2 shadow-2xs">
                                            <div className="w-9 h-9 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center mx-auto">
                                                <i className={`bi ${restaurantSubTab === 'pending' ? 'bi-check-circle-fill text-emerald-600' : 'bi-shop'} text-lg`}></i>
                                            </div>
                                            <p className="text-xs text-slate-900 font-bold">
                                                {restaurantSubTab === 'pending' ? '¡Todo al día!' : 'Sin registros'}
                                            </p>
                                            <p className="text-xs text-slate-500 font-medium">
                                                {restaurantSubTab === 'pending'
                                                    ? 'No hay restaurantes pendientes por liquidar'
                                                    : 'No hay registros de ventas para restaurantes'
                                                }
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-5">
                                            {todayStoreGroups.length > 0 && (
                                                <div className="space-y-2">
                                                    <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider pl-1 flex items-center gap-1.5">
                                                        <i className="bi bi-clock-fill text-slate-400"></i>
                                                        <span>Hoy ({todayStoreGroups.length})</span>
                                                    </h3>
                                                    <div className="space-y-3">
                                                        {todayStoreGroups.map(store => renderStoreCard(store))}
                                                    </div>
                                                </div>
                                            )}

                                            {previousStoreGroups.length > 0 && (
                                                <div className="space-y-2">
                                                    <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider pl-1 flex items-center gap-1.5">
                                                        <i className="bi bi-calendar-event-fill text-slate-400"></i>
                                                        <span>Anteriores ({previousStoreGroups.length})</span>
                                                    </h3>
                                                    <div className="space-y-3">
                                                        {previousStoreGroups.map(store => renderStoreCard(store))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        ) : (
                        /* Lista de Cierre de Repartidores Agrupada por Día y Subagrupada por Repartidor */
                        <div className="space-y-3">
                            {/* Selector de subpestañas Pendientes / Historial para Deliverys */}
                            <div className="flex bg-slate-200/60 p-1 rounded-xl shadow-2xs border border-slate-200/40 text-xs">
                                <button
                                    type="button"
                                    onClick={() => setDeliverySubTab('pending')}
                                    className={`flex-1 py-1.5 px-3 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer ${
                                        deliverySubTab === 'pending'
                                            ? 'bg-white text-slate-900 shadow-2xs font-black'
                                            : 'text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <span>Pendientes</span>
                                    {deliveryDaysGrouped.filter(d => !d.isDayFullySettled && d.pendingDriversCount > 0).length > 0 && (
                                        <span className="px-1.5 py-0.2 text-[9px] font-black rounded-full bg-amber-500 text-white shadow-2xs">
                                            {deliveryDaysGrouped.filter(d => !d.isDayFullySettled && d.pendingDriversCount > 0).length}
                                        </span>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDeliverySubTab('history')}
                                    className={`flex-1 py-1.5 px-3 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer ${
                                        deliverySubTab === 'history'
                                            ? 'bg-white text-slate-900 shadow-2xs font-black'
                                            : 'text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <span>Historial</span>
                                    <span className="px-1.5 py-0.2 text-[9px] font-semibold rounded-full bg-slate-200 text-slate-700">
                                        {deliveryDaysGrouped.length}
                                    </span>
                                </button>
                            </div>

                            {filteredDeliveryDays.length === 0 ? (
                                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 text-center space-y-2 shadow-2xs">
                                    <div className="w-9 h-9 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center mx-auto">
                                        <i className={`bi ${deliverySubTab === 'pending' ? 'bi-check-circle-fill text-emerald-600' : 'bi-scooter'} text-lg`}></i>
                                    </div>
                                    <p className="text-xs text-slate-900 font-bold">
                                        {deliverySubTab === 'pending' ? '¡Todo al día!' : 'Sin registros'}
                                    </p>
                                    <p className="text-xs text-slate-500 font-medium">
                                        {deliverySubTab === 'pending'
                                            ? 'No hay días con repartidores pendientes por liquidar'
                                            : 'No hay registros de envíos para repartidores'
                                        }
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {filteredDeliveryDays.map(day => {
                                        const isDayExpanded = Boolean(expandedDeliveryDays[day.dateStr])

                                        return (
                                            <div key={day.dateStr} className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden transition-all">
                                                {/* Cabecera del Día */}
                                                <div
                                                    onClick={() => toggleDeliveryDayExpand(day.dateStr)}
                                                    className="p-4 hover:bg-slate-50/60 transition-colors cursor-pointer flex flex-wrap items-center justify-between gap-3 select-none"
                                                >
                                                    <div className="min-w-0 flex-1 space-y-1">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <h4 className="font-bold text-sm text-slate-900 leading-tight">{day.displayDate}</h4>
                                                            <span className="text-[10px] font-semibold text-slate-400">
                                                                ({day.deliveryAccounts.length} {day.deliveryAccounts.length === 1 ? 'repartidor' : 'repartidores'})
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2.5 shrink-0">
                                                        {day.isDayFullySettled ? (
                                                            <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center gap-1.5 shadow-2xs">
                                                                <div className="w-3.5 h-3.5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[8px] font-black">
                                                                    ✓
                                                                </div>
                                                                <span>{day.settledDriversCount}/{day.totalDriversCount} Depositado</span>
                                                            </span>
                                                        ) : (
                                                            <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-amber-50 text-amber-900 border border-amber-200/80 flex items-center gap-1.5 shadow-2xs">
                                                                <div className="relative w-3.5 h-3.5 flex items-center justify-center shrink-0">
                                                                    <svg className="w-3.5 h-3.5 transform -rotate-90" viewBox="0 0 36 36">
                                                                        <path className="text-amber-200" strokeWidth="6" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                                                        <path className="text-amber-600 transition-all duration-300" strokeDasharray={`${(day.settledDriversCount / day.totalDriversCount) * 100}, 100`} strokeWidth="6" strokeLinecap="round" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                                                    </svg>
                                                                </div>
                                                                <span>Faltan {day.pendingDriversCount}/{day.totalDriversCount}</span>
                                                            </span>
                                                        )}
                                                        <i className={`bi bi-chevron-${isDayExpanded ? 'up' : 'down'} text-slate-400 text-xs ml-1`}></i>
                                                    </div>
                                                </div>
                                                {/* Subagrupación por Repartidor dentro del Día */}
                                                {isDayExpanded && (
                                                    <div className="border-t border-slate-100 bg-slate-50/50 p-3 space-y-3 animate-in fade-in duration-150">
                                                        {day.deliveryAccounts.map(driver => {
                                                            const driverKey = `${day.dateStr}_${driver.deliveryId}`
                                                            const isDriverExpanded = Boolean(expandedDayDeliveries[driverKey])
                                                            const isAllSettled = driver.pendingOrderCount === 0
                                                            const displayCash = isAllSettled ? driver.settledCashCollected : driver.cashCollected
                                                            const displayFee = isAllSettled ? driver.settledDeliveryFeeEarned : driver.deliveryFeeEarned
                                                            const displayNet = displayCash - displayFee
                                                            const isPositive = displayNet >= 0

                                                            return (
                                                                <div key={driver.deliveryId} className="bg-white rounded-xl border border-slate-200/80 shadow-2xs overflow-hidden">
                                                                    {/* Cabecera del Repartidor */}
                                                                    <div
                                                                        onClick={() => toggleDayDeliveryExpand(driverKey)}
                                                                        className="p-3.5 hover:bg-slate-50/50 transition-colors cursor-pointer flex justify-between items-center select-none"
                                                                    >
                                                                        <div>
                                                                            <h4 className="font-bold text-sm text-slate-900">{driver.name}</h4>
                                                                            <p className="text-xs text-slate-500 mt-0.5">{driver.orderCount} {driver.orderCount === 1 ? 'pedido' : 'pedidos'}</p>
                                                                        </div>

                                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                                            {driver.pendingOrderCount > 0 ? (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation()
                                                                                        handleSettleDriverAll(driver)
                                                                                    }}
                                                                                    className={`px-2.5 py-1 rounded-lg font-bold text-[11px] flex items-center gap-1 text-white shadow-2xs transition-all active:scale-95 cursor-pointer ${
                                                                                        isPositive
                                                                                            ? 'bg-emerald-600 hover:bg-emerald-700'
                                                                                            : 'bg-amber-600 hover:bg-amber-700'
                                                                                    }`}
                                                                                    title={`Liquidar cuentas de ${driver.name}`}
                                                                                >
                                                                                    <i className="bi bi-check2-all text-xs"></i>
                                                                                    <span>
                                                                                        {isPositive
                                                                                            ? `Recibir $${displayNet.toFixed(2)}`
                                                                                            : `Pagar $${Math.abs(displayNet).toFixed(2)}`
                                                                                        }
                                                                                    </span>
                                                                                </button>
                                                                            ) : (
                                                                                <span className="px-2.5 py-1 text-[10px] font-bold rounded-full flex items-center gap-1 border bg-emerald-50 text-emerald-700 border-emerald-200/60 shadow-2xs">
                                                                                    <i className="bi bi-check-circle-fill text-[10px]"></i>
                                                                                    <span>Liquidado ${Math.abs(displayNet).toFixed(2)}</span>
                                                                                </span>
                                                                            )}
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation()
                                                                                    handleSendWhatsAppSummaryForAccount(driver)
                                                                                }}
                                                                                className="w-7 h-7 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-200/80 flex items-center justify-center transition-all active:scale-95 cursor-pointer shadow-2xs shrink-0"
                                                                                title={`Enviar resumen por WhatsApp a ${driver.name}`}
                                                                            >
                                                                                <i className="bi bi-whatsapp text-xs"></i>
                                                                            </button>
                                                                            <i className={`bi bi-chevron-${isDriverExpanded ? 'up' : 'down'} text-slate-400 text-xs ml-0.5`}></i>
                                                                        </div>
                                                                    </div>

                                                                    {/* Detalle de Repartidor en el cuerpo desplegable */}
                                                                    {isDriverExpanded && (
                                                                        <div className="border-t border-slate-100 p-3 bg-slate-50/30 space-y-3 animate-in fade-in duration-150">
                                                                            {/* Resumen de Totales del Repartidor */}
                                                                            <div className="grid grid-cols-3 gap-2 bg-white p-2.5 rounded-xl text-center border border-slate-200/60 shadow-2xs text-xs">
                                                                                <div>
                                                                                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Efectivo</p>
                                                                                    <p className="font-bold text-slate-900 mt-0.5">${displayCash.toFixed(2)}</p>
                                                                                </div>
                                                                                <div>
                                                                                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Delivery</p>
                                                                                    <p className="font-bold text-emerald-600 mt-0.5">-${displayFee.toFixed(2)}</p>
                                                                                </div>
                                                                                <div>
                                                                                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                                                                                        {isAllSettled ? 'Liquidado' : 'Saldo Neto'}
                                                                                    </p>
                                                                                    <p className={`font-bold mt-0.5 ${isAllSettled ? 'text-emerald-600 font-black' : isPositive ? 'text-slate-900' : 'text-amber-600'}`}>
                                                                                        ${displayNet.toFixed(2)}
                                                                                    </p>
                                                                                </div>
                                                                            </div>

                                                                            {/* Lista de Pedidos del Repartidor en este día */}
                                                                            <div className="space-y-2">
                                                                                {driver.ordersList.map(order => {
                                                                                    const effectiveSettlement = localDeliverySettlementOverrides[order.id] || order.deliverySettlementStatus
                                                                                    const isSettled = effectiveSettlement === 'settled'
                                                                                    const isCash = order.payment?.method === 'cash'
                                                                                    const deliveryCost = order.delivery?.deliveryCost || 0

                                                                                    return (
                                                                                        <div key={order.id} className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-2xs space-y-2 text-xs">
                                                                                            <div className="flex items-center justify-between gap-2">
                                                                                                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                                                                                    <span className="font-bold text-slate-900">{order.customer?.name || 'Cliente'}</span>
                                                                                                    <span className="text-slate-400 text-[10px]">({getOrderDisplayTime(order)} • {isCash ? 'Efectivo' : 'Transferencia'})</span>
                                                                                                </div>

                                                                                                <button
                                                                                                    type="button"
                                                                                                    onClick={(e) => {
                                                                                                        e.stopPropagation()
                                                                                                        handleSettleDriverOrder(order)
                                                                                                    }}
                                                                                                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 shadow-2xs active:scale-95 cursor-pointer border ${
                                                                                                        isSettled
                                                                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                                                                                                            : 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent'
                                                                                                    }`}
                                                                                                >
                                                                                                    <i className={`bi ${isSettled ? 'bi-check-circle-fill' : 'bi-check2'} text-[10px]`}></i>
                                                                                                    <span>{isSettled ? 'Liquidado' : 'Liquidar'}</span>
                                                                                                </button>
                                                                                            </div>

                                                                                            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-slate-600 text-xs">
                                                                                                <div className="flex items-center gap-3">
                                                                                                    <span>Cobro: <strong className="text-slate-900">${(order.total || 0).toFixed(2)}</strong></span>
                                                                                                    <span className="text-slate-400">Delivery: <strong className="text-emerald-600">${deliveryCost.toFixed(2)}</strong></span>
                                                                                                </div>

                                                                                                <button
                                                                                                    type="button"
                                                                                                    onClick={(e) => {
                                                                                                        e.stopPropagation()
                                                                                                        onManagePayment(order)
                                                                                                    }}
                                                                                                    className="px-2 py-0.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1 shadow-2xs cursor-pointer"
                                                                                                >
                                                                                                    <i className="bi bi-pencil text-[10px]"></i>
                                                                                                    <span>Gestionar</span>
                                                                                                </button>
                                                                                            </div>
                                                                                        </div>
                                                                                    )
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                        )
                    ) : (
                        /* Show Details of Specific selected Delivery Today */
                        <div className="space-y-4">
                            {selectedAccount && (
                                <>
                                    {/* Driver Resume Card */}
                                    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3 animate-in fade-in duration-200">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h4 className="font-black text-base text-gray-900 leading-tight">{selectedAccount.name}</h4>
                                                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                                    {selectedAccount.celular && (
                                                        <a 
                                                            href={`tel:${selectedAccount.celular}`}
                                                            className="text-[10px] font-bold text-gray-400 flex items-center gap-1 hover:text-red-500 transition-colors"
                                                        >
                                                            <i className="bi bi-phone text-xs"></i> {selectedAccount.celular}
                                                        </a>
                                                    )}
                                                    {selectedAccount.celular && (
                                                        <button
                                                            onClick={handleSendWhatsAppSummary}
                                                            className="text-[10px] font-black text-emerald-600 hover:text-emerald-700 flex items-center gap-1 transition-colors"
                                                            title="Enviar resumen por WhatsApp"
                                                        >
                                                            <i className="bi bi-whatsapp text-xs"></i> Enviar Reporte
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setSelectedDeliveryId('all')}
                                                className="px-2.5 py-1 text-[10px] font-bold text-gray-500 hover:text-gray-900 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors shrink-0 animate-in fade-in active:scale-95"
                                            >
                                                Ver todos
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-3 gap-2 bg-gray-50 p-2.5 rounded-xl text-center">
                                            <div>
                                                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Efectivo</p>
                                                <p className="text-xs font-extrabold text-emerald-600 mt-0.5">${selectedAccount.cashCollected.toFixed(2)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Delivery</p>
                                                <p className="text-xs font-extrabold text-orange-600 mt-0.5">${selectedAccount.deliveryFeeEarned.toFixed(2)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Saldo Neto</p>
                                                <p className={`text-xs font-black mt-0.5 ${(selectedAccount.cashCollected - selectedAccount.deliveryFeeEarned) >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                                                    ${(selectedAccount.cashCollected - selectedAccount.deliveryFeeEarned).toFixed(2)}
                                                </p>
                                            </div>
                                        </div>
                                        {/* Liquidar button */}
                                        {selectedAccount.pendingOrderCount > 0 && (
                                            <div className="pt-3">
                                                <button
                                                    onClick={() => {
                                                        const pendingOrdersList = selectedAccount.ordersList.filter(o => o.deliverySettlementStatus !== 'settled')
                                                        handleSettleDriver(selectedAccount.deliveryId, selectedAccount.name, pendingOrdersList)
                                                    }}
                                                    disabled={settling}
                                                    className="w-full flex items-center justify-center gap-2 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 shadow-md shadow-green-100"
                                                >
                                                    {settling ? (
                                                        <>
                                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white animate-pulse"></div>
                                                            <span>Liquidando...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <i className="bi bi-check-all text-base"></i>
                                                            <span>Liquidar Cuentas</span>
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                        {selectedAccount.pendingOrderCount === 0 && selectedAccount.settledOrderCount > 0 && (
                                            <div className="mt-3 flex items-center justify-center gap-1.5 py-2.5 bg-green-50 border border-green-200 rounded-xl text-green-700 font-bold text-xs uppercase tracking-wider select-none">
                                                <i className="bi bi-check-circle-fill"></i>
                                                <span>Completamente Liquidado</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Orders list for this delivery */}
                                    <div className="space-y-2 animate-in fade-in duration-200">
                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Órdenes del Repartidor</h4>
                                        
                                        {/* unique store circles wrapper */}
                                        {driverStores.length > 0 && (
                                            <div className="flex flex-wrap items-center gap-2 py-1.5">
                                                {/* Button "Todas" */}
                                                <button
                                                    onClick={() => setSelectedStoreFilterId('all')}
                                                    className={`h-8 px-3 rounded-full border text-[9px] font-black uppercase tracking-wider transition-all duration-150 active:scale-95 flex items-center justify-center shrink-0 ${
                                                        selectedStoreFilterId === 'all'
                                                            ? 'bg-red-500 text-white border-red-500 shadow-sm'
                                                            : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700'
                                                    }`}
                                                >
                                                    Todas
                                                </button>

                                                {/* Store logos circles */}
                                                {driverStores.map(store => {
                                                    const isSelected = selectedStoreFilterId === store.id
                                                    return (
                                                        <button
                                                            key={store.id} 
                                                            onClick={() => setSelectedStoreFilterId(store.id)}
                                                            className={`w-8 h-8 rounded-full border shadow-sm overflow-hidden bg-gray-55 flex items-center justify-center shrink-0 transition-all duration-150 active:scale-95 ${
                                                                isSelected 
                                                                    ? 'border-red-500 ring-2 ring-red-100'
                                                                    : 'border-gray-200 hover:border-gray-300 hover:brightness-95'
                                                            }`}
                                                            title={store.name}
                                                        >
                                                            {store.image ? (
                                                                <img src={store.image} alt={store.name} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center bg-red-100 text-red-600 text-[10px] font-bold">
                                                                    <i className="bi bi-shop"></i>
                                                                </div>
                                                            )}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        )}
                                        
                                        {selectedAccount.ordersList.length === 0 ? (
                                            <p className="text-center text-xs text-gray-400 py-6 bg-white rounded-2xl border border-gray-55 font-medium uppercase tracking-wider">
                                                Sin pedidos cobrados hoy
                                            </p>
                                        ) : (
                                            <div className="space-y-3">
                                                {renderOrderGroup('Efectivo', 'cash', groupedOrders.cash, 'bi-cash text-emerald-600', 'bg-emerald-50')}
                                                {renderOrderGroup('Transferencia', 'transfer', groupedOrders.transfer, 'bi-bank text-blue-600', 'bg-blue-50')}
                                                {renderOrderGroup('Mixto', 'mixed', groupedOrders.mixed, 'bi-cash-coin text-amber-600', 'bg-amber-50')}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )
                }
            </div>

            {/* Modal de confirmación de liquidación total sin usar alert del navegador */}
            {storeToSettle && (() => {
                const isPositive = storeToSettle.pendingNetBalance >= 0
                const pendingOrders = storeToSettle.dates.flatMap((d: any) =>
                    d.storeAccount ? d.storeAccount.ordersList.filter((o: Order) => {
                        const status = localSettlementStatusOverrides[o.id] || o.settlementStatus
                        return status !== 'settled'
                    }) : []
                )

                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
                        <div className="bg-white w-full max-w-sm rounded-3xl border border-slate-100 shadow-2xl p-6 space-y-6 transform scale-100 transition-all duration-200 animate-in zoom-in-95">
                            {/* Header */}
                            <div className="text-center space-y-2">
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto text-xl shadow-2xs ${
                                    isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                                }`}>
                                    <i className="bi bi-wallet2"></i>
                                </div>
                                <h3 className="text-base font-black text-slate-900 leading-snug">
                                    ¿Confirmar liquidación total?
                                </h3>
                                <p className="text-xs text-slate-500 font-medium">
                                    Vas a marcar como liquidado todos los días pendientes de <strong className="text-slate-700">{storeToSettle.name}</strong>.
                                </p>
                            </div>

                            {/* Details */}
                            <div className="bg-slate-50 rounded-2xl p-4 space-y-2.5 text-xs border border-slate-100">
                                <div className="flex justify-between items-center text-slate-500 font-semibold">
                                    <span>Pedidos a liquidar</span>
                                    <span className="text-slate-800 font-bold">{pendingOrders.length}</span>
                                </div>
                                <div className="flex justify-between items-center text-slate-500 font-semibold">
                                    <span>Monto total</span>
                                    <span className={`font-black text-sm ${isPositive ? 'text-emerald-600' : 'text-amber-600'}`}>
                                        ${Math.abs(storeToSettle.pendingNetBalance).toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-slate-400 text-[10px] pt-2 border-t border-slate-200/60 font-semibold">
                                    <span>Tipo de operación</span>
                                    <span className="font-bold text-slate-500">
                                        {isPositive ? 'Transferencia (Fuddi paga)' : 'Cobro (Tienda paga)'}
                                    </span>
                                </div>
                            </div>

                            {/* Buttons */}
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setStoreToSettle(null)}
                                    className="flex-1 py-3 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 active:scale-95 transition-all cursor-pointer border border-transparent"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const store = storeToSettle
                                        setStoreToSettle(null)
                                        executeSettleStoreAllDates(store)
                                    }}
                                    className={`flex-1 py-3 rounded-xl text-xs font-bold text-white shadow-md active:scale-95 transition-all cursor-pointer border border-transparent ${
                                        isPositive
                                            ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200/50'
                                            : 'bg-amber-600 hover:bg-amber-700 shadow-amber-200/50'
                                    }`}
                                >
                                    Confirmar
                                </button>
                            </div>
                        </div>
                    </div>
                )
            })()}
        </div>
    )
}
