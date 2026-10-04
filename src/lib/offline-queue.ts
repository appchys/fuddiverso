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
const TASK_TIMEOUT_MS = 6000 // 6 segundos de tiempo límite por operación individual

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tiempo de espera agotado (${ms}ms) en ${label}`)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

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

    this.purgeStaleTasks()
    this.updateConnectivityTasksCount()
  }

  purgeStaleTasks() {
    const STALE_FAILED_MAX_AGE_MS = 4 * 60 * 60 * 1000 // 4 horas para tareas fallidas
    const ABSOLUTE_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 horas máximo absoluto
    const now = Date.now()

    const initialOrders = this.orderQueue.length
    const initialTasks = this.taskQueue.length

    this.orderQueue = this.orderQueue.filter(o => {
      const age = now - (o.createdAt || now)
      if (o.retryCount >= MAX_RETRIES && age > STALE_FAILED_MAX_AGE_MS) return false
      if (age > ABSOLUTE_MAX_AGE_MS) return false
      return true
    })

    this.taskQueue = this.taskQueue.filter(t => {
      const age = now - (t.createdAt || now)
      if (t.retryCount >= MAX_RETRIES && age > STALE_FAILED_MAX_AGE_MS) return false
      if (age > ABSOLUTE_MAX_AGE_MS) return false
      return true
    })

    if (this.orderQueue.length !== initialOrders || this.taskQueue.length !== initialTasks) {
      console.log('[OfflineQueue] Tareas u órdenes obsoletas purgadas de la cola local.')
      try {
        localStorage.setItem(ORDER_QUEUE_KEY, JSON.stringify(this.orderQueue))
        localStorage.setItem(TASKS_QUEUE_KEY, JSON.stringify(this.taskQueue))
      } catch (e) {
        console.error('[OfflineQueue] Error persistiendo tras purga:', e)
      }
    }
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
    const failedOrders = this.orderQueue.filter(o => o.retryCount >= MAX_RETRIES).length
    const failedTasks = this.taskQueue.filter(t => t.retryCount >= MAX_RETRIES).length
    const activePending = (this.orderQueue.length - failedOrders) + (this.taskQueue.length - failedTasks)
    setPendingTasks(activePending)
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

    this.purgeStaleTasks()
    this.syncing = true
    this.notifyListeners()

    try {
      // 1. Procesar órdenes encoladas (si hubiera alguna legacy)
      const ordersToProcess = this.orderQueue.filter(o => o.retryCount < MAX_RETRIES)
      const processedOrders: string[] = []

      for (const order of ordersToProcess) {
        try {
          if (order.mode === 'create') {
            await withTimeout(createOrder(order.orderData), TASK_TIMEOUT_MS, 'creación de orden')
          } else if (order.mode === 'edit' && order.editOrderId) {
            await withTimeout(updateOrder(order.editOrderId, order.orderData), TASK_TIMEOUT_MS, 'edición de orden')
          }
          processedOrders.push(order.id)
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          console.error('[OfflineQueue] Error syncing order:', errorMsg)
          const idx = this.orderQueue.findIndex(o => o.id === order.id)
          if (idx !== -1) {
            const isUnrecoverable =
              errorMsg.includes('No document to update') ||
              errorMsg.includes('not-found') ||
              errorMsg.includes('permission-denied')
            this.orderQueue[idx].retryCount = isUnrecoverable ? MAX_RETRIES : this.orderQueue[idx].retryCount + 1
            this.orderQueue[idx].lastAttempt = Date.now()
            this.orderQueue[idx].error = errorMsg
          }
        }
      }

      if (processedOrders.length > 0) {
        this.orderQueue = this.orderQueue.filter(o => !processedOrders.includes(o.id))
      }

      // 2. Procesar tareas secundarias en paralelo para sincronización rápida
      const tasksToProcess = this.taskQueue.filter(t => t.retryCount < MAX_RETRIES)
      const processedTasks: string[] = []

      if (tasksToProcess.length > 0) {
        await Promise.allSettled(
          tasksToProcess.map(async (task) => {
            try {
              await withTimeout(this.executeTask(task), TASK_TIMEOUT_MS, `tarea ${task.type}`)
              processedTasks.push(task.id)
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error)
              console.error(`[OfflineQueue] Error ejecutando tarea ${task.type}:`, errorMsg)
              const idx = this.taskQueue.findIndex(t => t.id === task.id)
              if (idx !== -1) {
                const isUnrecoverable =
                  errorMsg.includes('No document to update') ||
                  errorMsg.includes('not-found') ||
                  errorMsg.includes('permission-denied')
                this.taskQueue[idx].retryCount = isUnrecoverable ? MAX_RETRIES : this.taskQueue[idx].retryCount + 1
                this.taskQueue[idx].lastAttempt = Date.now()
                this.taskQueue[idx].error = errorMsg
              }
            }
          })
        )
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

  clearFailed(): void {
    const prevOrderCount = this.orderQueue.length
    const prevTaskCount = this.taskQueue.length
    this.orderQueue = this.orderQueue.filter(o => o.retryCount < MAX_RETRIES)
    this.taskQueue = this.taskQueue.filter(t => t.retryCount < MAX_RETRIES)
    if (this.orderQueue.length !== prevOrderCount || this.taskQueue.length !== prevTaskCount) {
      console.log('[OfflineQueue] Tareas fallidas descartadas.')
      this.saveQueues()
    }
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
