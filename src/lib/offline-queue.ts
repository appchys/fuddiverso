import { createOrder, updateOrder, registerOrderConsumption } from './database'
import { Timestamp } from 'firebase/firestore'

export interface PendingOrder {
    id: string // ID único del cliente
    orderData: any
    retryCount: number
    createdAt: number
    lastAttempt?: number
    error?: string
    mode: 'create' | 'edit'
    editOrderId?: string // ID de Firebase si es edición
    businessId: string
}

export interface QueueStatus {
    pending: number
    syncing: number
    failed: number
    lastSync?: number
}

const QUEUE_KEY = 'fuddi_pending_orders'
const MAX_RETRIES = 5
const INITIAL_RETRY_DELAY = 1000 // 1 segundo
const MAX_RETRY_DELAY = 60000 // 1 minuto

class OfflineOrderQueue {
    private queue: PendingOrder[] = []
    private syncing = false
    private listeners: Set<(status: QueueStatus) => void> = new Set()
    private syncInterval?: NodeJS.Timeout
    private onlineListener?: () => void

    constructor() {
        this.loadQueue()
        this.startAutoSync()
        this.setupOnlineListener()
    }

    // Cargar cola desde localStorage
    private loadQueue() {
        try {
            const stored = localStorage.getItem(QUEUE_KEY)
            if (stored) {
                this.queue = JSON.parse(stored)
            }
        } catch (error) {
            console.error('[OfflineQueue] Error loading queue:', error)
            this.queue = []
        }
    }

    // Guardar cola en localStorage
    private saveQueue() {
        try {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue))
            this.notifyListeners()
        } catch (error) {
            console.error('[OfflineQueue] Error saving queue:', error)
        }
    }

    // Generar ID único para el cliente
    private generateClientId(): string {
        return `pending_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }

    // Agregar orden a la cola
    async addToQueue(
        orderData: any,
        mode: 'create' | 'edit' = 'create',
        editOrderId?: string
    ): Promise<string> {
        const pendingOrder: PendingOrder = {
            id: this.generateClientId(),
            orderData,
            retryCount: 0,
            createdAt: Date.now(),
            mode,
            editOrderId,
            businessId: orderData.businessId
        }

        this.queue.push(pendingOrder)
        this.saveQueue()

        // Intentar procesar inmediatamente si estamos online
        if (navigator.onLine) {
            this.processQueue().catch(err => {
                console.error('[OfflineQueue] Error processing queue:', err)
            })
        }

        return pendingOrder.id
    }

    // Procesar la cola
    async processQueue(): Promise<void> {
        if (this.syncing || this.queue.length === 0) {
            return
        }

        if (!navigator.onLine) {
            console.log('[OfflineQueue] Offline, skipping sync')
            return
        }

        this.syncing = true
        this.notifyListeners()

        const toProcess = [...this.queue]
        const processed: string[] = []

        for (const order of toProcess) {
            // Verificar si debemos reintentar (backoff exponencial)
            if (order.lastAttempt) {
                const delay = Math.min(
                    INITIAL_RETRY_DELAY * Math.pow(2, order.retryCount),
                    MAX_RETRY_DELAY
                )
                const timeSinceLastAttempt = Date.now() - order.lastAttempt
                if (timeSinceLastAttempt < delay) {
                    continue // Esperar más tiempo
                }
            }

            // Verificar límite de reintentos
            if (order.retryCount >= MAX_RETRIES) {
                console.error('[OfflineQueue] Max retries reached for order:', order.id)
                continue
            }

            try {
                await this.syncOrder(order)
                processed.push(order.id)
            } catch (error) {
                console.error('[OfflineQueue] Error syncing order:', error)
                // Actualizar contador de reintentos
                const index = this.queue.findIndex(o => o.id === order.id)
                if (index !== -1) {
                    this.queue[index].retryCount++
                    this.queue[index].lastAttempt = Date.now()
                    this.queue[index].error = error instanceof Error ? error.message : 'Error desconocido'
                }
            }
        }

        // Remover órdenes procesadas exitosamente
        this.queue = this.queue.filter(o => !processed.includes(o.id))
        this.saveQueue()

        this.syncing = false
        this.notifyListeners()
    }

    // Sincronizar una orden individual
    private async syncOrder(order: PendingOrder): Promise<void> {
        if (order.mode === 'create') {
            // Crear nueva orden
            const orderId = await createOrder(order.orderData)

            // Registrar consumo de ingredientes
            try {
                const orderDateStr = new Date().toISOString().split('T')[0]
                const items = order.orderData.items.map((item: any) => ({
                    productId: item.productId,
                    variant: item.variant,
                    name: item.name,
                    quantity: item.quantity
                }))

                await registerOrderConsumption(
                    order.businessId,
                    items,
                    orderDateStr,
                    orderId
                )
            } catch (error) {
                console.error('[OfflineQueue] Error registering consumption:', error)
                // No fallar la orden completa por esto
            }
        } else if (order.mode === 'edit' && order.editOrderId) {
            // Actualizar orden existente
            await updateOrder(order.editOrderId, order.orderData)
        }
    }

    // Remover orden de la cola manualmente
    removeFromQueue(id: string): void {
        this.queue = this.queue.filter(o => o.id !== id)
        this.saveQueue()
    }

    // Obtener estado de la cola
    getQueueStatus(): QueueStatus {
        const failed = this.queue.filter(o => o.retryCount >= MAX_RETRIES).length
        const pending = this.queue.length - failed

        return {
            pending,
            syncing: this.syncing ? 1 : 0,
            failed,
            lastSync: this.queue.length > 0
                ? Math.max(...this.queue.map(o => o.lastAttempt || 0))
                : undefined
        }
    }

    // Obtener órdenes pendientes
    getPendingOrders(): PendingOrder[] {
        return [...this.queue]
    }

    // Reintentar órdenes fallidas
    async retryFailed(): Promise<void> {
        this.queue.forEach(order => {
            if (order.retryCount >= MAX_RETRIES) {
                order.retryCount = 0
                order.lastAttempt = undefined
                order.error = undefined
            }
        })
        this.saveQueue()
        await this.processQueue()
    }

    // Limpiar toda la cola (usar con precaución)
    clearQueue(): void {
        this.queue = []
        this.saveQueue()
    }

    // Iniciar sincronización automática
    private startAutoSync() {
        // Intentar sincronizar cada 30 segundos
        this.syncInterval = setInterval(() => {
            if (navigator.onLine && this.queue.length > 0) {
                this.processQueue().catch(err => {
                    console.error('[OfflineQueue] Auto-sync error:', err)
                })
            }
        }, 30000)
    }

    // Configurar listener para cambios de conexión
    private setupOnlineListener() {
        this.onlineListener = () => {
            console.log('[OfflineQueue] Connection restored, processing queue')
            this.processQueue().catch(err => {
                console.error('[OfflineQueue] Error processing queue on reconnect:', err)
            })
        }
        window.addEventListener('online', this.onlineListener)
    }

    // Suscribirse a cambios de estado
    subscribe(listener: (status: QueueStatus) => void): () => void {
        this.listeners.add(listener)
        // Enviar estado inicial
        listener(this.getQueueStatus())

        // Retornar función para desuscribirse
        return () => {
            this.listeners.delete(listener)
        }
    }

    // Notificar a todos los listeners
    private notifyListeners() {
        const status = this.getQueueStatus()
        this.listeners.forEach(listener => listener(status))
    }

    // Limpiar recursos
    destroy() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval)
        }
        if (this.onlineListener) {
            window.removeEventListener('online', this.onlineListener)
        }
        this.listeners.clear()
    }
}

// Singleton global
let queueInstance: OfflineOrderQueue | null = null

export function getOfflineQueue(): OfflineOrderQueue {
    if (!queueInstance) {
        queueInstance = new OfflineOrderQueue()
    }
    return queueInstance
}

export function destroyOfflineQueue() {
    if (queueInstance) {
        queueInstance.destroy()
        queueInstance = null
    }
}
