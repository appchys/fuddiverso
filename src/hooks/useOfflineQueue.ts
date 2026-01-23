import { useState, useEffect, useCallback } from 'react'
import { getOfflineQueue, QueueStatus, PendingOrder } from '@/lib/offline-queue'

export function useOfflineQueue() {
    const [queueStatus, setQueueStatus] = useState<QueueStatus>({
        pending: 0,
        syncing: 0,
        failed: 0
    })
    const [isSyncing, setIsSyncing] = useState(false)
    const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([])

    useEffect(() => {
        const queue = getOfflineQueue()

        // Suscribirse a cambios de estado
        const unsubscribe = queue.subscribe((status) => {
            setQueueStatus(status)
            setIsSyncing(status.syncing > 0)
            setPendingOrders(queue.getPendingOrders())
        })

        // Cargar estado inicial
        setPendingOrders(queue.getPendingOrders())

        return () => {
            unsubscribe()
        }
    }, [])

    const addOrder = useCallback(async (
        orderData: any,
        mode: 'create' | 'edit' = 'create',
        editOrderId?: string
    ): Promise<string> => {
        const queue = getOfflineQueue()
        return await queue.addToQueue(orderData, mode, editOrderId)
    }, [])

    const retryFailed = useCallback(async () => {
        const queue = getOfflineQueue()
        await queue.retryFailed()
    }, [])

    const clearQueue = useCallback(() => {
        const queue = getOfflineQueue()
        queue.clearQueue()
    }, [])

    const removeOrder = useCallback((id: string) => {
        const queue = getOfflineQueue()
        queue.removeFromQueue(id)
    }, [])

    return {
        queueStatus,
        isSyncing,
        pendingOrders,
        addOrder,
        retryFailed,
        clearQueue,
        removeOrder
    }
}
