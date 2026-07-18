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

interface CierreSidebarViewProps {
    orders: Order[]
    availableDeliveries: Delivery[]
    onBack: () => void
    selectedBusinessId: string | null
    businesses: Business[]
    onManagePayment: (order: Order) => void
}

// Función helper pura para calcular el resumen de cuentas de los repartidores
function calculateDeliveryAccounts(ordersList: Order[], deliveriesList: Delivery[]) {
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

        const isSettled = o.deliverySettlementStatus === 'settled'
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

    // Filtrar los que no están asignados o repartidores sin pedidos que no están en deliveriesList
    const list = Array.from(accountsMap.values()).filter(acc => {
        if (acc.deliveryId === unassignedId) {
            return acc.orderCount > 0
        }
        return true
    })

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
    selectedBusinessId,
    businesses,
    onManagePayment
}: CierreSidebarViewProps) {
    // Estados principales
    const [activeTab, setActiveTab] = useState<'hoy' | 'historial'>('hoy')
    const [selectedDeliveryId, setSelectedDeliveryId] = useState<string>('all')
    const [collapsedGroups, setCollapsedGroups] = useState<{ cash: boolean, transfer: boolean, mixed: boolean }>({
        cash: false,
        transfer: false,
        mixed: false
    })
    const [selectedStoreFilterId, setSelectedStoreFilterId] = useState<string>('all')

    // Estados de Historial
    const [historyOrders, setHistoryOrders] = useState<Order[]>([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [daysToShow, setDaysToShow] = useState(15)
    const [expandedDay, setExpandedDay] = useState<string | null>(null)
    const [selectedHistoryDelivery, setSelectedHistoryDelivery] = useState<{ dateStr: string, deliveryId: string } | null>(null)
    const [selectedHistoryStoreFilterId, setSelectedHistoryStoreFilterId] = useState<string>('all')

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
        if (activeTab !== 'historial' || !selectedBusinessId) return

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
    }, [activeTab, selectedBusinessId, daysToShow])

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
            `• Fletes a deducir: $${totalFee.toFixed(2)}\n` +
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
            `• Fletes totales a deducir: $${totalFee.toFixed(2)}\n` +
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

    // Adaptador genérico para enviar reportes de WhatsApp para cualquier cuenta
    const handleSendWhatsAppSummaryForAccount = (account: any) => {
        const cel = account.celular
        if (!cel) {
            alert("El repartidor no tiene número de celular registrado.")
            return
        }

        let cleanCel = cel.replace(/\D/g, '') // Eliminar todo lo que no sea dígito
        if (cleanCel.startsWith('00')) {
            cleanCel = cleanCel.substring(2)
        }
        if (cleanCel.length === 10 && cleanCel.startsWith('0')) {
            cleanCel = '593' + cleanCel.substring(1)
        } else if (cleanCel.length === 9 && cleanCel.startsWith('9')) {
            cleanCel = '593' + cleanCel
        }

        const isFullySettled = account.pendingOrderCount === 0

        const emojiEfectivo = '💵'
        const emojiMotoneta = '🛵'
        
        const cash = isFullySettled ? account.settledCashCollected : account.cashCollected
        const fee = isFullySettled ? account.settledDeliveryFeeEarned : account.deliveryFeeEarned
        const count = isFullySettled ? account.settledOrderCount : account.pendingOrderCount
        const netCash = cash - fee

        const targetStatus = isFullySettled ? 'settled' : 'pending'

        const labelEntregarRecibir = netCash >= 0 ? 'Valor a entregar:' : 'Valor a recibir:'
        const netCashDisplay = Math.abs(netCash)

        let message = `*${emojiEfectivo} Efectivo cobrado:* $${cash.toFixed(2)}\n` +
            `*${emojiMotoneta} Servicio de delivery:* $${fee.toFixed(2)}\n` +
            `_(${count} entregas)_\n\n` +
            `*${labelEntregarRecibir}* $${netCashDisplay.toFixed(2)}\n\n`

        const cashOrders = account.ordersList.filter((o: Order) => {
            const isMatch = targetStatus === 'settled' 
                ? o.deliverySettlementStatus === 'settled' 
                : o.deliverySettlementStatus !== 'settled'
            return isMatch && (o.payment?.method === 'cash' || o.payment?.method === 'mixed')
        })

        if (cashOrders.length > 0) {
            message += `*Efectivo*\n`
            cashOrders.forEach((o: Order) => {
                const amount = o.payment?.method === 'mixed' ? (o.payment?.cashAmount || 0) : (o.total || 0)
                message += `${o.customer?.name || 'Cliente'} - $${amount.toFixed(2)}\n`
            })
            message += `\n`
        }

        const transferOrders = account.ordersList.filter((o: Order) => {
            const isMatch = targetStatus === 'settled' 
                ? o.deliverySettlementStatus === 'settled' 
                : o.deliverySettlementStatus !== 'settled'
            return isMatch && (o.payment?.method === 'transfer' || o.payment?.method === 'mixed')
        })

        if (transferOrders.length > 0) {
            message += `*Transferencias*\n`
            transferOrders.forEach((o: Order) => {
                const amount = o.payment?.method === 'mixed' ? (o.payment?.transferAmount || 0) : (o.total || 0)
                message += `${o.customer?.name || 'Cliente'} - $${amount.toFixed(2)}\n`
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
        return calculateDeliveryAccounts(activeOrders, availableDeliveries)
    }, [activeOrders, availableDeliveries])

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

    const getLocalDateString = (date: Date) => {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const getOrderReferenceDate = (order: Order) => {
        return order.timing?.type === 'scheduled' && order.timing.scheduledDate
            ? toSafeDate(order.timing.scheduledDate)
            : toSafeDate(order.createdAt)
    }

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

                {/* Delivery Selector in Header (solo se muestra en la pestaña Hoy) */}
                {activeTab === 'hoy' && (
                    <div className="relative shrink-0 w-32">
                        <select
                            value={selectedDeliveryId}
                            onChange={(e) => setSelectedDeliveryId(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-2 pr-5 py-1.5 text-[10px] font-black text-gray-700 focus:outline-none focus:ring-1 focus:ring-red-100 transition-all appearance-none cursor-pointer truncate"
                        >
                            <option value="all">Todos</option>
                            {deliveryAccounts.map(acc => (
                                <option key={acc.deliveryId} value={acc.deliveryId}>
                                    {acc.name}
                                </option>
                            ))}
                        </select>
                        <i className="bi bi-chevron-down absolute right-2 top-2.5 text-gray-400 text-[8px] pointer-events-none"></i>
                    </div>
                )}
            </div>

            {/* Pestañas Hoy / Historial (solo cuando no se está viendo el detalle de un repartidor hoy ni en el historial) */}
            {selectedDeliveryId === 'all' && !selectedHistoryDelivery && (
                <div className="px-4 py-2 bg-white border-b border-gray-100 shrink-0">
                    <div className="flex bg-gray-100 p-1 rounded-xl shadow-sm border border-gray-200/20">
                        <button
                            onClick={() => setActiveTab('hoy')}
                            className={`flex-1 py-1.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all duration-150 ${
                                activeTab === 'hoy'
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-400 hover:text-gray-700'
                            }`}
                        >
                            Hoy
                        </button>
                        <button
                            onClick={() => setActiveTab('historial')}
                            className={`flex-1 py-1.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all duration-150 ${
                                activeTab === 'historial'
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-400 hover:text-gray-700'
                            }`}
                        >
                            Historial
                        </button>
                    </div>
                </div>
            )}

            {/* Scrollable View Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {activeTab === 'hoy' ? (
                    // --- VISTA DE HOY ---
                    selectedDeliveryId === 'all' ? (
                        /* Show List of all Deliveries with Accounts */
                        <div className="space-y-3">
                            {/* Resumen Global Card Group */}
                            <div className="space-y-2">
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Resumen Global (Hoy)</h3>
                                
                                <div className="grid grid-cols-2 gap-2">
                                    {/* Efectivo Card */}
                                    <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
                                        <div className="w-9 h-9 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center shrink-0">
                                            <i className="bi bi-cash-stack text-lg"></i>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide leading-none">Efectivo Pend.</p>
                                            <p className="text-base font-black text-emerald-600 mt-1">${globalTotals.pendingCash.toFixed(2)}</p>
                                            {globalTotals.settledCash > 0 && (
                                                <p className="text-[8px] text-gray-400 font-semibold mt-0.5">Liq: ${globalTotals.settledCash.toFixed(2)}</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Transferencia Card */}
                                    <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
                                        <div className="w-9 h-9 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
                                            <i className="bi bi-bank text-lg"></i>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide leading-none">Transf. Pend.</p>
                                            <p className="text-base font-black text-blue-600 mt-1">${globalTotals.pendingTransfer.toFixed(2)}</p>
                                            {globalTotals.settledTransfer > 0 && (
                                                <p className="text-[8px] text-gray-400 font-semibold mt-0.5">Liq: ${globalTotals.settledTransfer.toFixed(2)}</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Costo de Envio Card */}
                                    <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
                                        <div className="w-9 h-9 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center shrink-0">
                                            <i className="bi bi-scooter text-lg"></i>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide leading-none">Envío Pend.</p>
                                            <p className="text-base font-black text-orange-600 mt-1">${globalTotals.pendingDeliveriesFee.toFixed(2)}</p>
                                            {globalTotals.settledDeliveriesFee > 0 && (
                                                <p className="text-[8px] text-gray-400 font-semibold mt-0.5">Liq: ${globalTotals.settledDeliveriesFee.toFixed(2)}</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Total Card */}
                                    <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
                                        <div className="w-9 h-9 bg-gray-50 text-gray-800 rounded-xl flex items-center justify-center shrink-0">
                                            <i className="bi bi-currency-dollar text-lg font-bold"></i>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide leading-none">Total Pendiente</p>
                                            <p className="text-base font-black text-gray-900 mt-1">${(globalTotals.pendingCash + globalTotals.pendingTransfer).toFixed(2)}</p>
                                            {(globalTotals.settledCash + globalTotals.settledTransfer) > 0 && (
                                                <p className="text-[8px] text-gray-400 font-semibold mt-0.5">Total Liq: ${(globalTotals.settledCash + globalTotals.settledTransfer).toFixed(2)}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="text-[10px] text-gray-400 font-semibold italic text-right">
                                    Basado en {globalTotals.totalCount} pedidos hoy. {globalTotals.settledCount > 0 && `(${globalTotals.settledCount} liquidados)`}
                                </div>
                            </div>

                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-2">Cuentas de Repartidores</h3>
                            
                            {deliveryAccounts.filter(acc => (acc.deliveryId !== 'unassigned' || acc.orderCount > 0) && acc.pendingOrderCount > 0).length === 0 ? (
                                <div className="bg-white p-6 rounded-2xl border border-gray-100 text-center space-y-2 shadow-sm">
                                    <div className="w-10 h-10 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto">
                                        <i className="bi bi-check2-circle text-xl"></i>
                                    </div>
                                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                        Todos los repartidores liquidados hoy
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {deliveryAccounts.filter(acc => (acc.deliveryId !== 'unassigned' || acc.orderCount > 0) && acc.pendingOrderCount > 0).map(acc => {
                                        const netCash = acc.cashCollected - acc.deliveryFeeEarned
                                        return (
                                            <div 
                                                key={acc.deliveryId}
                                                onClick={() => setSelectedDeliveryId(acc.deliveryId)}
                                                className="bg-white p-4 rounded-2xl border border-gray-100 hover:border-red-100 hover:shadow-md transition-all cursor-pointer space-y-3 animate-in fade-in duration-200"
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <h4 className="font-bold text-sm text-gray-900 leading-tight">{acc.name}</h4>
                                                        {acc.celular && <p className="text-[10px] text-gray-400 mt-0.5">{acc.celular}</p>}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-gray-100 text-gray-600 rounded-lg">
                                                            {acc.orderCount} ent.
                                                        </span>
                                                        {acc.pendingOrderCount === 0 && acc.settledOrderCount > 0 ? (
                                                            <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-green-50 text-green-700 rounded-lg flex items-center gap-0.5">
                                                                <i className="bi bi-check-circle-fill"></i> Liq.
                                                            </span>
                                                        ) : (
                                                            acc.settledOrderCount > 0 && (
                                                                <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-blue-50 text-blue-600 rounded-lg">
                                                                    {acc.settledOrderCount} liq.
                                                                </span>
                                                            )
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-3 gap-2 bg-gray-50 p-2.5 rounded-xl text-center">
                                                    <div>
                                                        <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Efectivo</p>
                                                        <p className="text-xs font-extrabold text-emerald-600 mt-0.5">${acc.cashCollected.toFixed(2)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Fletes</p>
                                                        <p className="text-xs font-extrabold text-orange-600 mt-0.5">${acc.deliveryFeeEarned.toFixed(2)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Saldo Neto</p>
                                                        <p className={`text-xs font-black mt-0.5 ${netCash >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                                                            ${netCash.toFixed(2)}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-red-600 border-t border-gray-55 pt-2 shrink-0">
                                                    <span>Ver detalle de órdenes</span>
                                                    <i className="bi bi-chevron-right text-xs"></i>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
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
                                                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Fletes</p>
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
                ) : (
                    // --- VISTA DE HISTORIAL ---
                    selectedHistoryDelivery ? (
                        /* Detalle del repartidor seleccionado del historial */
                        <div className="space-y-4">
                            {selectedHistoryAccount && (
                                <>
                                    {/* Cabecera de navegación interna */}
                                    <div className="flex items-center gap-2 shrink-0 animate-in fade-in duration-150">
                                        <button
                                            onClick={() => setSelectedHistoryDelivery(null)}
                                            className="px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-500 hover:text-gray-900 bg-white border border-gray-200 rounded-xl transition-colors flex items-center gap-1.5 shrink-0 shadow-sm active:scale-95"
                                        >
                                            <i className="bi bi-chevron-left text-xs"></i> Volver al historial
                                        </button>
                                    </div>

                                    {/* Driver Resume Card */}
                                    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3 animate-in fade-in duration-200">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h4 className="font-black text-base text-gray-900 leading-tight">{selectedHistoryAccount.name}</h4>
                                                <p className="text-[10px] text-gray-400 mt-1 font-bold uppercase tracking-wider">
                                                    Cuentas del {groupedHistoryDays.find(d => d.dateStr === selectedHistoryDelivery.dateStr)?.displayDate}
                                                </p>
                                                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                                    {selectedHistoryAccount.celular && (
                                                        <a 
                                                            href={`tel:${selectedHistoryAccount.celular}`}
                                                            className="text-[10px] font-bold text-gray-400 flex items-center gap-1 hover:text-red-500 transition-colors"
                                                        >
                                                            <i className="bi bi-phone text-xs"></i> {selectedHistoryAccount.celular}
                                                        </a>
                                                    )}
                                                    {selectedHistoryAccount.celular && (
                                                        <button
                                                            onClick={() => handleSendWhatsAppSummaryForAccount(selectedHistoryAccount)}
                                                            className="text-[10px] font-black text-emerald-600 hover:text-emerald-700 flex items-center gap-1 transition-colors"
                                                            title="Enviar resumen por WhatsApp"
                                                        >
                                                            <i className="bi bi-whatsapp text-xs"></i> Enviar Reporte
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-2 bg-gray-50 p-2.5 rounded-xl text-center">
                                            <div>
                                                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Efectivo</p>
                                                <p className="text-xs font-extrabold text-emerald-600 mt-0.5">${selectedHistoryAccount.cashCollected.toFixed(2)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Fletes</p>
                                                <p className="text-xs font-extrabold text-orange-600 mt-0.5">${selectedHistoryAccount.deliveryFeeEarned.toFixed(2)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Saldo Neto</p>
                                                <p className={`text-xs font-black mt-0.5 ${(selectedHistoryAccount.cashCollected - selectedHistoryAccount.deliveryFeeEarned) >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                                                    ${(selectedHistoryAccount.cashCollected - selectedHistoryAccount.deliveryFeeEarned).toFixed(2)}
                                                </p>
                                            </div>
                                        </div>
                                        {/* Liquidar button */}
                                        {selectedHistoryAccount.pendingOrderCount > 0 && (
                                            <div className="pt-3">
                                                <button
                                                    onClick={() => {
                                                        const pendingOrdersList = selectedHistoryAccount.ordersList.filter(o => o.deliverySettlementStatus !== 'settled')
                                                        handleSettleDriver(selectedHistoryAccount.deliveryId, selectedHistoryAccount.name, pendingOrdersList)
                                                    }}
                                                    disabled={settling}
                                                    className="w-full flex items-center justify-center gap-2 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 shadow-md shadow-green-100"
                                                >
                                                    {settling ? (
                                                        <span>Liquidando...</span>
                                                    ) : (
                                                        <>
                                                            <i className="bi bi-check-all text-base"></i>
                                                            <span>Liquidar Cuentas</span>
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                        {selectedHistoryAccount.pendingOrderCount === 0 && selectedHistoryAccount.settledOrderCount > 0 && (
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
                                        {historyDriverStores.length > 0 && (
                                            <div className="flex flex-wrap items-center gap-2 py-1.5">
                                                <button
                                                    onClick={() => setSelectedHistoryStoreFilterId('all')}
                                                    className={`h-8 px-3 rounded-full border text-[9px] font-black uppercase tracking-wider transition-all duration-150 active:scale-95 flex items-center justify-center shrink-0 ${
                                                        selectedHistoryStoreFilterId === 'all'
                                                            ? 'bg-red-500 text-white border-red-500 shadow-sm'
                                                            : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700'
                                                    }`}
                                                >
                                                    Todas
                                                </button>

                                                {historyDriverStores.map(store => {
                                                    const isSelected = selectedHistoryStoreFilterId === store.id
                                                    return (
                                                        <button
                                                            key={store.id} 
                                                            onClick={() => setSelectedHistoryStoreFilterId(store.id)}
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
                                        
                                        {selectedHistoryAccount.ordersList.length === 0 ? (
                                            <p className="text-center text-xs text-gray-400 py-6 bg-white rounded-2xl border border-gray-55 font-medium uppercase tracking-wider">
                                                Sin pedidos cobrados este día
                                            </p>
                                        ) : (
                                            <div className="space-y-3">
                                                {renderOrderGroup('Efectivo', 'cash', groupedHistoryOrders.cash, 'bi-cash text-emerald-600', 'bg-emerald-50')}
                                                {renderOrderGroup('Transferencia', 'transfer', groupedHistoryOrders.transfer, 'bi-bank text-blue-600', 'bg-blue-50')}
                                                {renderOrderGroup('Mixto', 'mixed', groupedHistoryOrders.mixed, 'bi-cash-coin text-amber-600', 'bg-amber-50')}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        /* Lista de días agrupados en el historial */
                        <div className="space-y-4 animate-in fade-in duration-200">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Historial de Cierres</h3>

                            {historyLoading && historyOrders.length === 0 ? (
                                <div className="flex justify-center items-center py-12">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-red-600"></div>
                                </div>
                            ) : groupedHistoryDays.length === 0 ? (
                                <div className="bg-white p-6 rounded-2xl border border-gray-100 text-center space-y-2 shadow-sm">
                                    <div className="w-10 h-10 bg-gray-55/20 text-gray-400 rounded-full flex items-center justify-center mx-auto">
                                        <i className="bi bi-calendar-x text-lg"></i>
                                    </div>
                                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                        Sin cierres de caja registrados
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {groupedHistoryDays.map(day => {
                                        const isExpanded = expandedDay === day.dateStr
                                        const pendingDayOrders = day.ordersList.filter(o => o.delivery?.type === 'delivery' && o.deliverySettlementStatus !== 'settled')
                                        const dayDeliveries = calculateDeliveryAccounts(day.ordersList, availableDeliveries)
                                        
                                        return (
                                            <div key={day.dateStr} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-all duration-200">
                                                {/* Cabecera del día */}
                                                <div 
                                                    onClick={() => setExpandedDay(isExpanded ? null : day.dateStr)}
                                                    className="p-4 hover:bg-gray-50/50 transition-colors cursor-pointer flex items-center justify-between gap-3 select-none"
                                                >
                                                    <div className="min-w-0 flex-1 space-y-1">
                                                        <h4 className="font-bold text-sm text-gray-900 leading-tight truncate">{day.displayDate}</h4>
                                                        <div className="flex items-center gap-2 text-[10px] text-gray-400 font-semibold">
                                                            <span>{day.deliveryOrdersCount} entregas</span>
                                                            {day.deliveryOrdersCount > 0 && (
                                                                <>
                                                                    <span>•</span>
                                                                    <span className="text-gray-500">Saldo Neto: ${day.netCash.toFixed(2)}</span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2.5 shrink-0">
                                                        {day.deliveryOrdersCount === 0 ? (
                                                            <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-gray-100 text-gray-500 rounded-lg">
                                                                Sin envíos
                                                            </span>
                                                        ) : day.isSettled ? (
                                                            <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-green-50 text-green-700 rounded-lg flex items-center gap-0.5">
                                                                <i className="bi bi-check-circle-fill text-[10px]"></i> Liq.
                                                            </span>
                                                        ) : (
                                                            <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 rounded-lg flex items-center gap-0.5">
                                                                <i className="bi bi-exclamation-circle-fill text-[10px]"></i> Pend.
                                                            </span>
                                                        )}
                                                        <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 text-xs`}></i>
                                                    </div>
                                                </div>

                                                {/* Contenido expandido del día */}
                                                {isExpanded && (
                                                    <div className="border-t border-gray-50 bg-gray-50/30 p-4 space-y-4 animate-in fade-in duration-200">
                                                        {/* Resumen Financiero del Día */}
                                                        <div className="grid grid-cols-3 gap-2 bg-white p-3 rounded-xl border border-gray-100 text-center">
                                                            <div>
                                                                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Efectivo</p>
                                                                <p className="text-xs font-extrabold text-emerald-600 mt-0.5">${day.totalCash.toFixed(2)}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Fletes</p>
                                                                <p className="text-xs font-extrabold text-orange-600 mt-0.5">${day.totalFee.toFixed(2)}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide">Saldo Neto</p>
                                                                <p className={`text-xs font-black mt-0.5 ${day.netCash >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                                                                    ${day.netCash.toFixed(2)}
                                                                </p>
                                                            </div>
                                                        </div>

                                                        {/* Repartidores del día */}
                                                        <div className="space-y-2">
                                                            <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cuentas por Repartidor</h5>
                                                            
                                                            {dayDeliveries.filter(acc => acc.orderCount > 0).map(acc => {
                                                                const netCash = acc.cashCollected - acc.deliveryFeeEarned
                                                                return (
                                                                    <div 
                                                                        key={acc.deliveryId}
                                                                        onClick={() => setSelectedHistoryDelivery({ dateStr: day.dateStr, deliveryId: acc.deliveryId })}
                                                                        className="bg-white p-3 rounded-xl border border-gray-100 hover:border-red-100 hover:shadow-sm transition-all cursor-pointer flex items-center justify-between gap-3 animate-in fade-in"
                                                                    >
                                                                        <div className="min-w-0 flex-1">
                                                                            <h6 className="font-bold text-xs text-gray-900 truncate">{acc.name}</h6>
                                                                            <div className="flex items-center gap-2 text-[9px] text-gray-400 font-semibold mt-0.5">
                                                                                <span>{acc.orderCount} ent.</span>
                                                                                <span>•</span>
                                                                                <span className={netCash >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                                                                                    Neto: ${netCash.toFixed(2)}
                                                                                </span>
                                                                            </div>
                                                                        </div>

                                                                        <div className="shrink-0 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                                                            {acc.pendingOrderCount === 0 ? (
                                                                                <span className="px-2 py-1 text-[8px] font-black uppercase bg-green-50 text-green-700 rounded-lg flex items-center gap-0.5">
                                                                                    <i className="bi bi-check-circle-fill text-[9px]"></i> Liquidado
                                                                                </span>
                                                                            ) : (
                                                                                <button
                                                                                    onClick={() => {
                                                                                        const pendingOrdersList = acc.ordersList.filter(o => o.deliverySettlementStatus !== 'settled')
                                                                                        handleSettleDriver(acc.deliveryId, acc.name, pendingOrdersList)
                                                                                    }}
                                                                                    disabled={settling}
                                                                                    className="px-2 py-1.5 text-[8px] font-black uppercase tracking-wider bg-green-600 hover:bg-green-700 text-white rounded-lg transition-all active:scale-95 flex items-center gap-1 shadow-sm disabled:opacity-50"
                                                                                >
                                                                                    <i className="bi bi-check2 text-[10px]"></i> Liquidar
                                                                                </button>
                                                                            )}
                                                                            <button 
                                                                                onClick={() => setSelectedHistoryDelivery({ dateStr: day.dateStr, deliveryId: acc.deliveryId })}
                                                                                className="p-1 text-gray-400 hover:text-gray-700 rounded-lg transition-colors flex items-center"
                                                                                title="Ver detalle de órdenes"
                                                                            >
                                                                                <i className="bi bi-chevron-right text-sm"></i>
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

                                    {/* Botón Cargar Más */}
                                    <button
                                        onClick={() => setDaysToShow(prev => prev + 15)}
                                        className="w-full py-3 text-xs font-black uppercase tracking-wider text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-all border border-dashed border-gray-200/80 active:scale-98 bg-white shadow-sm"
                                    >
                                        Cargar más días
                                    </button>
                                </div>
                            )}
                        </div>
                    )
                )}
            </div>
        </div>
    )
}
