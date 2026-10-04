import {
  createOrder,
  updateOrder,
  registerOrderConsumption,
  createClient,
  searchClientByPhone,
  useUserCreditsFlexible,
  creditReferral,
  upsertOrderTrackingNotification
} from './database'
import { setPendingTasks } from './connectivity'

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

export type OfflineTaskType =
  | 'registerConsumption'
  | 'ensureClient'
  | 'deductCredits'
  | 'trackingNotification'
  | 'creditReferral'
  | 'completeCheckout'

export interface OfflineTask {
  id: string // Clave de idempotencia
  type: OfflineTaskType
  payload: any
  retryCount: number
  createdAt: number
  lastAttempt?: number
  error?: string
}

export interface QueueStatus {
  pending: number
  syncing: number
  failed: number
  lastSync?: number
}

const ORDER_QUEUE_KEY = 'fuddi_pending_orders'
const TASKS_QUEUE_KEY = 'fuddi_pending_tasks'
const MAX_RETRIES = 5
const INITIAL_RETRY_DELAY = 1000 // 1 segundo
const MAX_RETRY_DELAY = 60000 // 1 minuto

class OfflineManager {
  private orderQueue: PendingOrder[] = []
  private taskQueue: OfflineTask[] = []
  private syncing = false
  private listeners: Set<(status: QueueStatus) => void> = new Set()
  private syncInterval?: NodeJS.Timeout
  private onlineListener?: () => void

  constructor() {
    this.loadQueues()
    this.startAutoSync()
    this.setupOnlineListener()
  }

  // Cargar colas desde localStorage
  private loadQueues() {
    if (typeof window === 'undefined') return
    try {
      const storedOrders = localStorage.getItem(ORDER_QUEUE_KEY)
      if (storedOrders) this.orderQueue = JSON.parse(storedOrders)
    } catch (error) {
      console.error('[OfflineQueue] Error loading order queue:', error)
      this.orderQueue = []
    }

    try {
      const storedTasks = localStorage.getItem(TASKS_QUEUE_KEY)
      if (storedTasks) this.taskQueue = JSON.parse(storedTasks)
    } catch (error) {
      console.error('[OfflineQueue] Error loading tasks queue:', error)
      this.taskQueue = []
    }

    this.updateConnectivityTasksCount()
  }

  private saveQueues() {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(ORDER_QUEUE_KEY, JSON.stringify(this.orderQueue))
    } catch (error) {
      console.error('[OfflineQueue] Error saving order queue:', error)
    }
    try {
      localStorage.setItem(TASKS_QUEUE_KEY, JSON.stringify(this.taskQueue))
    } catch (error) {
      console.error('[OfflineQueue] Error saving tasks queue:', error)
    }
    this.updateConnectivityTasksCount()
    this.notifyListeners()
  }

  private updateConnectivityTasksCount() {
    const totalPending = this.orderQueue.length + this.taskQueue.length
    setPendingTasks(totalPending)
  }

  // --- Tareas Secundarias ---
  enqueueTask(type: OfflineTaskType, payload: any, customId?: string) {
    const id = customId || `task_${type}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    
    // Si ya existe una tarea con la misma clave (idempotencia), no duplicar
    if (this.taskQueue.some(t => t.id === id)) {
      return
    }

    this.taskQueue.push({
      id,
      type,
      payload,
      retryCount: 0,
      createdAt: Date.now()
    })

    this.saveQueues()

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      this.processQueue().catch(() => {})
    }
  }

  // --- Órdenes Clásicas ---
  private generateClientId(): string {
    return `pending_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

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

    this.orderQueue.push(pendingOrder)
    this.saveQueues()

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      this.processQueue().catch(err => {
        console.error('[OfflineQueue] Error processing queue:', err)
      })
    }

    return pendingOrder.id
  }

  // Procesar todo lo pendiente
  async processQueue(): Promise<void> {
    if (this.syncing || (this.orderQueue.length === 0 && this.taskQueue.length === 0)) {
      return
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return
    }

    this.syncing = true
    this.notifyListeners()

    try {
      // 1. Procesar órdenes encoladas (si hubiera alguna legacy)
      const ordersToProcess = [...this.orderQueue]
      const processedOrders: string[] = []

      for (const order of ordersToProcess) {
        if (order.retryCount >= MAX_RETRIES) continue

        try {
          if (order.mode === 'create') {
            await createOrder(order.orderData)
          } else if (order.mode === 'edit' && order.editOrderId) {
            await updateOrder(order.editOrderId, order.orderData)
          }
          processedOrders.push(order.id)
        } catch (error) {
          console.error('[OfflineQueue] Error syncing order:', error)
          const idx = this.orderQueue.findIndex(o => o.id === order.id)
          if (idx !== -1) {
            this.orderQueue[idx].retryCount++
            this.orderQueue[idx].lastAttempt = Date.now()
            this.orderQueue[idx].error = error instanceof Error ? error.message : 'Error desconocido'
          }
        }
      }

      if (processedOrders.length > 0) {
        this.orderQueue = this.orderQueue.filter(o => !processedOrders.includes(o.id))
      }

      // 2. Procesar tareas secundarias
      const tasksToProcess = [...this.taskQueue]
      const processedTasks: string[] = []

      for (const task of tasksToProcess) {
        if (task.retryCount >= MAX_RETRIES) continue

        try {
          await this.executeTask(task)
          processedTasks.push(task.id)
        } catch (error) {
          console.error(`[OfflineQueue] Error ejecutando tarea ${task.type}:`, error)
          const idx = this.taskQueue.findIndex(t => t.id === task.id)
          if (idx !== -1) {
            this.taskQueue[idx].retryCount++
            this.taskQueue[idx].lastAttempt = Date.now()
            this.taskQueue[idx].error = error instanceof Error ? error.message : 'Error desconocido'
          }
        }
      }

      if (processedTasks.length > 0) {
        this.taskQueue = this.taskQueue.filter(t => !processedTasks.includes(t.id))
      }

      this.saveQueues()
    } finally {
      this.syncing = false
      this.notifyListeners()
    }
  }

  private async executeTask(task: OfflineTask): Promise<void> {
    const { type, payload } = task
    switch (type) {
      case 'registerConsumption': {
        const { businessId, items, orderDate, orderId } = payload
        await registerOrderConsumption(businessId, items, orderDate, orderId)
        break
      }
      case 'ensureClient': {
        const { phone, name, email } = payload
        const existing = await searchClientByPhone(phone)
        if (!existing) {
          await createClient({
            celular: phone,
            nombres: name,
            email: email || undefined,
            fecha_de_registro: new Date().toLocaleDateString('es-ES')
          })
        }
        break
      }
      case 'deductCredits': {
        const { identifiers, businessId, creditToDeduct, orderId } = payload
        await useUserCreditsFlexible(identifiers, businessId, creditToDeduct, orderId)
        break
      }
      case 'creditReferral': {
        const { orderId, referralCode } = payload
        await creditReferral(orderId, referralCode)
        break
      }
      case 'trackingNotification': {
        const { orderId, status, customerPhone, businessId } = payload
        await upsertOrderTrackingNotification(orderId, status, customerPhone, businessId)
        break
      }
      case 'completeCheckout': {
        const { checkoutSessionId, orderId } = payload
        const { doc, updateDoc } = await import('firebase/firestore')
        const { db } = await import('./firebase')
        await updateDoc(doc(db, 'checkoutProgress', checkoutSessionId), {
          currentStep: 5,
          completedAt: new Date(),
          convertedToOrderId: orderId
        })
        break
      }
      default:
        console.warn(`[OfflineQueue] Tipo de tarea no reconocido: ${type}`)
    }
  }

  getQueueStatus(): QueueStatus {
    const failedOrders = this.orderQueue.filter(o => o.retryCount >= MAX_RETRIES).length
    const failedTasks = this.taskQueue.filter(t => t.retryCount >= MAX_RETRIES).length
    const pendingOrders = this.orderQueue.length - failedOrders
    const pendingTasks = this.taskQueue.length - failedTasks

    const allAttempts = [
      ...this.orderQueue.map(o => o.lastAttempt || 0),
      ...this.taskQueue.map(t => t.lastAttempt || 0)
    ]

    return {
      pending: pendingOrders + pendingTasks,
      syncing: this.syncing ? 1 : 0,
      failed: failedOrders + failedTasks,
      lastSync: allAttempts.length > 0 ? Math.max(...allAttempts) : undefined
    }
  }

  getPendingOrders(): PendingOrder[] {
    return [...this.orderQueue]
  }

  async retryFailed(): Promise<void> {
    this.orderQueue.forEach(order => {
      if (order.retryCount >= MAX_RETRIES) {
        order.retryCount = 0
        order.lastAttempt = undefined
        order.error = undefined
      }
    })
    this.taskQueue.forEach(task => {
      if (task.retryCount >= MAX_RETRIES) {
        task.retryCount = 0
        task.lastAttempt = undefined
        task.error = undefined
      }
    })
    this.saveQueues()
    await this.processQueue()
  }

  removeFromQueue(id: string): void {
    this.orderQueue = this.orderQueue.filter(o => o.id !== id)
    this.taskQueue = this.taskQueue.filter(t => t.id !== id)
    this.saveQueues()
  }

  clearQueue(): void {
    this.orderQueue = []
    this.taskQueue = []
    this.saveQueues()
  }

  private startAutoSync() {
    this.syncInterval = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine && (this.orderQueue.length > 0 || this.taskQueue.length > 0)) {
        this.processQueue().catch(err => {
          console.error('[OfflineQueue] Auto-sync error:', err)
        })
      }
    }, 25000)
  }

  private setupOnlineListener() {
    if (typeof window === 'undefined') return
    this.onlineListener = () => {
      console.log('[OfflineQueue] Conexión detectada, procesando colas...')
      this.processQueue().catch(err => {
        console.error('[OfflineQueue] Error procesando en reconexión:', err)
      })
    }
    window.addEventListener('online', this.onlineListener)
  }

  subscribe(listener: (status: QueueStatus) => void): () => void {
    this.listeners.add(listener)
    listener(this.getQueueStatus())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners() {
    const status = this.getQueueStatus()
    this.listeners.forEach(listener => listener(status))
  }

  destroy() {
    if (this.syncInterval) clearInterval(this.syncInterval)
    if (this.onlineListener && typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineListener)
    }
    this.listeners.clear()
  }
}

let queueInstance: OfflineManager | null = null

export function getOfflineQueue(): OfflineManager {
  if (!queueInstance) {
    queueInstance = new OfflineManager()
  }
  return queueInstance
}

export function destroyOfflineQueue() {
  if (queueInstance) {
    queueInstance.destroy()
    queueInstance = null
  }
}
