import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  setDoc,
  query,
  where,
  limit,
  orderBy,
  serverTimestamp,
  increment as firestoreIncrement,
  Timestamp,
  getCountFromServer
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage, googleProvider, auth } from './firebase'
export { storage }
import { normalizeEcuadorianPhone } from './validation'
import {
  signInWithRedirect,
  getRedirectResult,
  UserCredential,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth'
import {
  Business,
  Product,
  ProductVariant,
  Ingredient,
  Order,
  CoverageZone,
  Delivery,
  QRCode,
  UserQRProgress
} from '../types'

// Interfaz para egresos (expenses)
export interface ExpenseEntry {
  id?: string
  businessId: string
  date: string // 'YYYY-MM-DD'
  concept: string
  amount: number
  paymentMethod?: string
  createdAt?: any
}

/**
 * Crear un nuevo egreso
 */
export async function createExpense(expense: Omit<ExpenseEntry, 'id' | 'createdAt'>): Promise<string> {
  try {
    const now = new Date();
    const expenseData = {
      ...expense,
      createdAt: serverTimestamp(),
      date: expense.date || now.toISOString().split('T')[0] // Asegurar que siempre haya un campo date
    };
    const docRef = await addDoc(collection(db, 'expenses'), expenseData);
    return docRef.id;
  } catch (error) {
    console.error('Error creating expense:', error);
    throw error;
  }
}

export async function unredeemQRCodePrize(userId: string, businessId: string, qrCodeId: string): Promise<{
  success: boolean
  message: string
}> {
  try {
    const progress = await getUserQRProgress(userId, businessId)

    if (!progress) {
      return { success: false, message: 'No tienes progreso registrado' }
    }

    const redeemed = progress.redeemedPrizeCodes || []
    if (!redeemed.includes(qrCodeId)) {
      return { success: true, message: 'Premio ya estaba disponible' }
    }

    const q = query(
      collection(db, 'userQRProgress'),
      where('userId', '==', userId),
      where('businessId', '==', businessId),
      limit(1)
    )
    const snapshot = await getDocs(q)

    if (snapshot.empty) {
      return { success: false, message: 'No tienes progreso registrado' }
    }

    const docRef = snapshot.docs[0].ref
    const updated = redeemed.filter(id => id !== qrCodeId)
    await updateDoc(docRef, {
      redeemedPrizeCodes: updated,
      updatedAt: serverTimestamp()
    })

    return { success: true, message: 'Premio disponible nuevamente' }
  } catch (error) {
    console.error('Error unredeeming QR prize:', error)
    return { success: false, message: 'Error al revertir el canje' }
  }
}

/**
 * Obtener egresos de un negocio en un rango de fechas
 */
export async function getExpensesByBusiness(
  businessId: string,
  startDate?: Date,
  endDate?: Date
): Promise<ExpenseEntry[]> {
  try {
    const expensesRef = collection(db, 'expenses')
    let q

    if (startDate && endDate) {
      // Convertir fechas a string YYYY-MM-DD para comparar con el campo date
      const startStr = startDate.toISOString().split('T')[0]
      const endStr = endDate.toISOString().split('T')[0]

      // Si es el mismo día, buscamos exactamente esa fecha
      if (startStr === endStr) {
        q = query(
          expensesRef,
          where('businessId', '==', businessId),
          where('date', '==', startStr),
          orderBy('createdAt', 'desc')
        )
      } else {
        q = query(
          expensesRef,
          where('businessId', '==', businessId),
          where('date', '>=', startStr),
          where('date', '<=', endStr),
          orderBy('date', 'desc'),
          orderBy('createdAt', 'desc')
        )
      }
    } else {
      // Si no hay fechas, traer todos los egresos del negocio
      q = query(
        expensesRef,
        where('businessId', '==', businessId),
        orderBy('date', 'desc'),
        orderBy('createdAt', 'desc')
      )
    }

    const snapshot = await getDocs(q)
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as ExpenseEntry[]
  } catch (error) {
    console.error('Error getting expenses:', error)
    return []
  }
}

/**
 * Eliminar un egreso por id
 */
export async function deleteExpense(expenseId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'expenses', expenseId))
  } catch (error) {
    console.error('Error deleting expense:', error)
    throw error
  }
}

// Helper function para convertir timestamps de Firebase a Date de manera segura
function toSafeDate(timestamp: any): Date {
  if (!timestamp) return new Date()
  if (timestamp instanceof Date) return timestamp
  if (timestamp?.toDate && typeof timestamp.toDate === 'function') {
    return timestamp.toDate()
  }
  return new Date(timestamp)
}

// Helper function para limpiar valores undefined de un objeto
function cleanObject(obj: any): any {
  if (obj === null || obj === undefined) {
    return null
  }

  if (Array.isArray(obj)) {
    return obj.map(cleanObject).filter(item => item !== null && item !== undefined)
  }

  if (typeof obj === 'object') {
    const cleaned: any = {}
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = cleanObject(value)
      }
    }
    return cleaned
  }

  return obj
}

// Helper para formatear fecha a DD/MM/YYYY
function formatDateDDMMYYYY(d?: Date | string) {
  const date = d ? new Date(d) : new Date()
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = date.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

// Funciones para Negocios
export async function createBusiness(businessData: Omit<Business, 'id' | 'createdAt'>) {
  try {
    console.log('🔄 Attempting to create business:', businessData);

    // Validar datos requeridos
    if (!businessData.name || !businessData.email || !businessData.phone || !businessData.address) {
      throw new Error('Faltan datos requeridos: nombre, email, teléfono y dirección son obligatorios.');
    }

    // Filtrar valores undefined antes de enviar a Firestore
    const cleanBusinessData = cleanObject(businessData)

    const docRef = await addDoc(collection(db, 'businesses'), {
      ...cleanBusinessData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    console.log('✅ Business created successfully with ID:', docRef.id);
    return docRef.id;
  } catch (error: any) {
    console.error('❌ Error creating business:', error);

    // Proporcionar mensajes de error más específicos
    if (error.code === 'permission-denied') {
      throw new Error('No tienes permisos para crear un negocio. Verifica las reglas de Firestore.');
    } else if (error.code === 'unavailable') {
      throw new Error('El servicio de Firebase no está disponible. Inténtalo más tarde.');
    } else if (error.code === 'invalid-argument') {
      throw new Error('Los datos del negocio no son válidos.');
    } else if (error.code === 'unauthenticated') {
      throw new Error('No estás autenticado. Inicia sesión primero.');
    }

    throw new Error(`Error al crear el negocio: ${error.message || error}`);
  }
}

// Función auxiliar para crear un negocio desde datos del formulario
export async function createBusinessFromForm(formData: {
  name: string;
  username: string;
  email: string;
  phone: string;
  address: string;
  description: string;
  category?: string;
  image?: string;
  references?: string;
  ownerId?: string;
}) {
  const businessData: Omit<Business, 'id' | 'createdAt'> = {
    name: formData.name,
    username: formData.username,
    email: formData.email,
    phone: formData.phone,
    address: formData.address,
    description: formData.description,
    image: formData.image,
    ownerId: formData.ownerId,
    references: formData.references || '',
    categories: [],
    mapLocation: {
      lat: 0, // Se puede actualizar posteriormente
      lng: 0
    },
    schedule: {
      monday: { open: '09:00', close: '18:00', isOpen: true },
      tuesday: { open: '09:00', close: '18:00', isOpen: true },
      wednesday: { open: '09:00', close: '18:00', isOpen: true },
      thursday: { open: '09:00', close: '18:00', isOpen: true },
      friday: { open: '09:00', close: '18:00', isOpen: true },
      saturday: { open: '09:00', close: '18:00', isOpen: true },
      sunday: { open: '09:00', close: '18:00', isOpen: false }
    },
    isActive: true,
    updatedAt: new Date()
  };

  return await createBusiness(businessData);
}

export async function getBusiness(businessId: string): Promise<Business | null> {
  try {
    const docRef = doc(db, 'businesses', businessId)
    const docSnap = await getDoc(docRef)

    if (docSnap.exists()) {
      return {
        id: docSnap.id,
        ...docSnap.data(),
        createdAt: toSafeDate(docSnap.data().createdAt)
      } as Business
    }
    return null
  } catch (error) {
    console.error('Error getting business:', error)
    throw error
  }
}

export async function getBusinessByOwner(ownerId: string): Promise<Business | null> {
  try {
    console.log('🔍 Searching for business with ownerId:', ownerId);

    const q = query(
      collection(db, 'businesses'),
      where('ownerId', '==', ownerId),
      limit(1)
    )
    const querySnapshot = await getDocs(q)

    console.log('📊 Query result is empty:', querySnapshot.empty);
    console.log('📊 Query size:', querySnapshot.size);

    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0]
      const businessData = {
        id: doc.id,
        ...doc.data(),
        createdAt: toSafeDate(doc.data().createdAt)
      } as Business

      console.log('✅ Found business:', businessData.name, 'ID:', businessData.id);
      return businessData
    }

    console.log('❌ No business found for ownerId:', ownerId);
    return null
  } catch (error) {
    console.error('❌ Error getting business by owner:', error)
    throw error
  }
}

export async function getAllBusinesses(): Promise<Business[]> {
  try {
    const querySnapshot = await getDocs(collection(db, 'businesses'))
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: toSafeDate(doc.data().createdAt)
    })) as Business[]
  } catch (error) {
    console.error('Error getting businesses:', error)
    throw error
  }
}

export async function updateBusiness(businessId: string, data: Partial<Business>) {
  try {
    // Filtrar valores undefined antes de enviar a Firestore
    const cleanData = cleanObject(data)

    const docRef = doc(db, 'businesses', businessId)
    await updateDoc(docRef, cleanData)
  } catch (error) {
    console.error('Error updating business:', error)
    throw error
  }
}

// Funciones para administradores de negocios
export async function addBusinessAdministrator(
  businessId: string,
  adminEmail: string,
  role: 'admin' | 'manager',
  permissions: any,
  addedByUid: string
) {
  try {
    // Crear el nuevo administrador sin serverTimestamp
    const newAdmin = {
      uid: '', // Se necesitaría obtener el UID del email
      email: adminEmail,
      role,
      addedAt: new Date(), // Usar Date en lugar de serverTimestamp
      addedBy: addedByUid,
      permissions
    }

    const businessRef = doc(db, 'businesses', businessId)
    const businessDoc = await getDoc(businessRef)

    if (!businessDoc.exists()) {
      throw new Error('Negocio no encontrado')
    }

    const businessData = businessDoc.data() as Business
    const currentAdmins = businessData.administrators || []

    // Verificar si el admin ya existe
    const existingAdmin = currentAdmins.find(admin => admin.email === adminEmail)
    if (existingAdmin) {
      throw new Error('Este usuario ya es administrador del negocio')
    }

    // Agregar el nuevo administrador
    const updatedAdmins = [...currentAdmins, newAdmin]
    await updateDoc(businessRef, {
      administrators: updatedAdmins,
      updatedAt: serverTimestamp() // Solo usar serverTimestamp en campos top-level
    })

    return true
  } catch (error) {
    console.error('Error adding administrator:', error)
    throw error
  }
}

export async function removeBusinessAdministrator(businessId: string, adminEmail: string) {
  try {
    const businessRef = doc(db, 'businesses', businessId)
    const businessDoc = await getDoc(businessRef)

    if (!businessDoc.exists()) {
      throw new Error('Negocio no encontrado')
    }

    const businessData = businessDoc.data() as Business
    const currentAdmins = businessData.administrators || []

    // Filtrar el administrador a remover
    const updatedAdmins = currentAdmins.filter(admin => admin.email !== adminEmail)
    await updateDoc(businessRef, { administrators: updatedAdmins })

    return true
  } catch (error) {
    console.error('Error removing administrator:', error)
    throw error
  }
}

export async function updateAdministratorPermissions(
  businessId: string,
  adminEmail: string,
  newPermissions: any
) {
  try {
    const businessRef = doc(db, 'businesses', businessId)
    const businessDoc = await getDoc(businessRef)

    if (!businessDoc.exists()) {
      throw new Error('Negocio no encontrado')
    }

    const businessData = businessDoc.data() as Business
    const currentAdmins = businessData.administrators || []

    // Actualizar permisos del administrador
    const updatedAdmins = currentAdmins.map(admin =>
      admin.email === adminEmail
        ? { ...admin, permissions: newPermissions }
        : admin
    )

    await updateDoc(businessRef, { administrators: updatedAdmins })

    return true
  } catch (error) {
    console.error('Error updating permissions:', error)
    throw error
  }
}

export async function transferBusinessOwnership(businessId: string, newOwnerEmail: string, currentOwnerUid: string) {
  try {
    // Esta función requeriría verificaciones adicionales de seguridad
    const businessRef = doc(db, 'businesses', businessId)
    const businessDoc = await getDoc(businessRef)

    if (!businessDoc.exists()) {
      throw new Error('Negocio no encontrado')
    }

    const businessData = businessDoc.data() as Business

    // Verificar que el usuario actual es el propietario
    if (businessData.ownerId !== currentOwnerUid) {
      throw new Error('Solo el propietario puede transferir el negocio')
    }

    // Aquí se necesitaría obtener el UID del nuevo propietario desde su email
    // Por ahora solo actualizamos el email hasta implementar la búsqueda de usuarios
    await updateDoc(businessRef, {
      email: newOwnerEmail,
      updatedAt: serverTimestamp()
    })

    return true
  } catch (error) {
    console.error('Error transferring ownership:', error)
    throw error
  }
}

// Funciones para Productos
export async function createProduct(productData: Omit<Product, 'id' | 'createdAt'>) {
  try {
    // Filtrar valores undefined antes de enviar a Firestore
    const cleanProductData = cleanObject(productData)

    const docRef = await addDoc(collection(db, 'products'), {
      ...cleanProductData,
      createdAt: serverTimestamp()
    })
    return docRef.id
  } catch (error) {
    console.error('Error creating product:', error)
    throw error
  }
}

export async function getProductsByBusiness(businessId: string): Promise<Product[]> {
  try {
    const q = query(
      collection(db, 'products'),
      where('businessId', '==', businessId),
      orderBy('createdAt', 'desc')
    )
    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: toSafeDate(doc.data().createdAt)
    })) as Product[]
  } catch (error) {
    console.error('Error getting products:', error)
    throw error
  }
}

export async function updateProduct(productId: string, data: Partial<Product>) {
  try {
    // Filtrar valores undefined antes de enviar a Firestore
    const cleanData = cleanObject(data)

    const docRef = doc(db, 'products', productId)
    await updateDoc(docRef, cleanData)
  } catch (error) {
    console.error('Error updating product:', error)
    throw error
  }
}

export async function deleteProduct(productId: string) {
  try {
    const existing = await getProduct(productId)

    if (existing?.image) {
      try {
        const url = new URL(existing.image)
        const pathPart = url.pathname.split('/o/')[1]
        if (pathPart) {
          const fullPath = decodeURIComponent(pathPart.split('?')[0])
          const storageRef = ref(storage, fullPath)
          await deleteObject(storageRef)
        }
      } catch (e) {
        console.warn('Failed to delete product image from storage for', productId, e)
      }
    }

    const docRef = doc(db, 'products', productId)
    await deleteDoc(docRef)
  } catch (error) {
    console.error('Error deleting product:', error)
    throw error
  }
}

// Obtener un producto por su ID
export async function getProduct(productId: string): Promise<Product | null> {
  try {
    const docRef = doc(db, 'products', productId)
    const docSnap = await getDoc(docRef)

    if (!docSnap.exists()) {
      return null
    }

    return {
      id: docSnap.id,
      ...docSnap.data()
    } as Product
  } catch (error) {
    console.error('Error getting product:', error)
    return null
  }
}

// Obtener el negocio que contiene un producto
export async function getBusinessByProduct(productId: string): Promise<Business | null> {
  try {
    const product = await getProduct(productId)
    if (!product || !product.businessId) {
      return null
    }

    return await getBusiness(product.businessId)
  } catch (error) {
    console.error('Error getting business by product:', error)
    return null
  }
}

// Funciones para Pedidos
export async function createOrder(orderData: Omit<Order, 'id' | 'createdAt'>) {
  try {
    // Filtrar valores undefined antes de enviar a Firestore
    const cleanOrderData = cleanObject(orderData)

    // Asegurarnos que siempre tenga la estructura correcta
    const standardizedOrder = {
      ...cleanOrderData,
      status: cleanOrderData.status || 'pending',
      createdByAdmin: cleanOrderData.createdByAdmin ?? false,
      delivery: {
        type: cleanOrderData.delivery?.type || 'pickup',
        references: cleanOrderData.delivery?.references || '',
        latlong: cleanOrderData.delivery?.latlong || '',
        deliveryCost: cleanOrderData.delivery?.deliveryCost || 0,
        // preservar repartidor asignado cuando viene desde la UI (p. ej. ManualOrderSidebar)
        assignedDelivery: cleanOrderData.delivery?.assignedDelivery ?? null
      },
      statusHistory: {
        ...(cleanOrderData.statusHistory || {}),
        pendingAt: cleanOrderData.statusHistory?.pendingAt || serverTimestamp(),
        ...(cleanOrderData.createdByAdmin ? { confirmedAt: serverTimestamp() } : {})
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }

    // Si es una orden manual, asegurarse que tenga toda la estructura de statusHistory
    if (standardizedOrder.createdByAdmin) {
      standardizedOrder.statusHistory = {
        pendingAt: standardizedOrder.statusHistory.pendingAt,
        confirmedAt: null,
        preparingAt: null,
        readyAt: null,
        deliveredAt: null,
        cancelledAt: null,
        ...standardizedOrder.statusHistory // Preservar timestamps existentes
      }
    }

    const docRef = await addDoc(collection(db, 'orders'), standardizedOrder)

    // 3. REGISTRO AUTOMÁTICO DE CONSUMO (Punto 4 del pedido)
    try {
      await registerOrderConsumption(
        standardizedOrder.businessId,
        standardizedOrder.items.map((item: any) => ({
          productId: item.productId,
          variant: item.variant?.name || item.variantId,
          name: item.product?.name || item.name || '',
          quantity: item.quantity
        })),
        new Date().toISOString().split('T')[0],
        docRef.id
      )
    } catch (consumeError) {
      console.error('Error al descontar stock automáticamente:', consumeError)
    }

    return docRef.id
  } catch (error) {
    console.error('Error creating order:', error)
    throw error
  }
}

export async function getOrdersByBusiness(businessId: string): Promise<Order[]> {
  try {
    const q = query(
      collection(db, 'orders'),
      where('businessId', '==', businessId),
      where('status', '!=', 'cancelled')
      // Temporalmente comentado hasta crear el índice
      // orderBy('createdAt', 'desc')
    )
    const querySnapshot = await getDocs(q)
    const orders = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: parseCreatedAt(doc.data().createdAt)
    })) as Order[]

    // Ordenar en JavaScript como alternativa temporal
    return orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  } catch (error) {
    console.error('Error getting orders:', error)
    throw error
  }
}

// Obtiene solo los pedidos recientes (de hoy en adelante) para un negocio específico.
// Esto se usa para el dashboard en la pestaña de "Hoy" para evitar cargar
// todo el historial desde Firebase en el primer render.
// Para pedidos programados, usa la fecha programada (timing.scheduledDate) si está disponible.
export async function getRecentOrdersByBusiness(businessId: string): Promise<Order[]> {
  try {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // Obtenemos todos los pedidos del negocio
    const allOrders = await getOrdersByBusiness(businessId)

    // Filtramos los pedidos recientes usando la fecha de referencia correcta
    const recentOrders = allOrders.filter(order => {
      const orderDate = getOrderReferenceDate(order)
      return orderDate >= today
    })

    // Ordenamos por la fecha de referencia
    return recentOrders.sort((a, b) => {
      const dateA = getOrderReferenceDate(a)
      const dateB = getOrderReferenceDate(b)
      return dateB.getTime() - dateA.getTime()
    })
  } catch (error) {
    console.error('Error getting recent orders:', error)
    throw error
  }
}

// Obtiene los pedidos históricos (anteriores a hoy) para un negocio específico.
// Se usará de forma lazy cuando el usuario entre a la pestaña de Historial.
// Para pedidos programados, usa la fecha programada (timing.scheduledDate) si está disponible.
export async function getHistoricalOrdersByBusiness(businessId: string): Promise<Order[]> {
  try {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // Obtenemos todos los pedidos del negocio
    const allOrders = await getOrdersByBusiness(businessId)

    // Filtramos los pedidos históricos usando la fecha de referencia correcta
    const historicalOrders = allOrders.filter(order => {
      const orderDate = getOrderReferenceDate(order)
      return orderDate < today
    })

    // Ordenamos por la fecha de referencia
    return historicalOrders.sort((a, b) => {
      const dateA = getOrderReferenceDate(a)
      const dateB = getOrderReferenceDate(b)
      return dateB.getTime() - dateA.getTime()
    })
  } catch (error) {
    console.error('Error getting historical orders:', error)
    throw error
  }
}

// Función auxiliar para obtener la fecha de referencia de un pedido
function getOrderReferenceDate(order: Order): Date {
  // Si es un pedido programado y tiene scheduledDate, usamos esa fecha
  if (order.timing?.type === 'scheduled' && order.timing.scheduledDate) {
    // Si es un Timestamp de Firestore (con seconds)
    if (typeof order.timing.scheduledDate === 'object' && 'seconds' in order.timing.scheduledDate) {
      return new Date(order.timing.scheduledDate.seconds * 1000);
    }
    // Si es un string de fecha
    if (typeof order.timing.scheduledDate === 'string') {
      return new Date(order.timing.scheduledDate);
    }
  }
  // Si no es programado o no tiene scheduledDate, usar createdAt
  return order.createdAt instanceof Date ? order.createdAt : parseCreatedAt(order.createdAt);
}

// Helper function para convertir createdAt a Date
function parseCreatedAt(createdAt: any): Date {
  if (!createdAt) {
    return new Date()
  }

  // Si es un Timestamp de Firestore
  if (createdAt && typeof createdAt.toDate === 'function') {
    return createdAt.toDate()
  }

  // Si es una cadena de fecha
  if (typeof createdAt === 'string') {
    return new Date(createdAt)
  }

  // Si ya es un objeto Date
  if (createdAt instanceof Date) {
    return createdAt
  }

  // Si es un objeto con seconds (Timestamp serializado)
  if (createdAt && createdAt.seconds) {
    return new Date(createdAt.seconds * 1000)
  }

  // Fallback
  return new Date()
}

export async function getAllOrders(): Promise<Order[]> {
  try {
    const q = query(
      collection(db, 'orders'),
      orderBy('createdAt', 'desc')
    )
    const querySnapshot = await getDocs(q)
    const orders = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: parseCreatedAt(doc.data().createdAt)
    })) as Order[]

    return orders
  } catch (error) {
    console.error('Error getting all orders:', error)
    // Si falla el orderBy, intentar sin él
    try {
      const querySnapshot = await getDocs(collection(db, 'orders'))
      const orders = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: parseCreatedAt(doc.data().createdAt)
      })) as Order[]

      // Ordenar en JavaScript
      return orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    } catch (fallbackError) {
      console.error('Error in fallback query:', fallbackError)
      throw fallbackError
    }
  }
}

export async function updateOrderStatus(orderId: string, status: Order['status']) {
  try {
    const docRef = doc(db, 'orders', orderId)
    // Mapear el campo de historial correspondiente al estado
    const historyFieldMap: Record<Order['status'], string> = {
      pending: 'statusHistory.pendingAt',
      confirmed: 'statusHistory.confirmedAt',
      preparing: 'statusHistory.preparingAt',
      ready: 'statusHistory.readyAt',
      delivered: 'statusHistory.deliveredAt',
      cancelled: 'statusHistory.cancelledAt'
    }

    const updatePayload: any = {
      status,
      updatedAt: serverTimestamp(),
      [historyFieldMap[status]]: serverTimestamp()
    }

    // Además, mantener un alias plano deliveredAt para consultas/UX cuando aplica
    if (status === 'delivered') {
      updatePayload.deliveredAt = serverTimestamp()
    }

    await updateDoc(docRef, updatePayload)
  } catch (error) {
    console.error('Error updating order status:', error)
    throw error
  }
}

export async function getOrder(orderId: string): Promise<Order | null> {
  try {
    const docRef = doc(db, 'orders', orderId)
    const docSnap = await getDoc(docRef)

    if (docSnap.exists()) {
      return {
        id: docSnap.id,
        ...docSnap.data(),
        createdAt: parseCreatedAt(docSnap.data().createdAt)
      } as Order
    }
    return null
  } catch (error) {
    console.error('Error getting order:', error)
    throw error
  }
}

export async function updateOrder(orderId: string, orderData: Partial<Omit<Order, 'id' | 'createdAt'>>) {
  try {
    const docRef = doc(db, 'orders', orderId)
    const cleanData = cleanObject(orderData)
    await updateDoc(docRef, {
      ...cleanData,
      updatedAt: serverTimestamp()
    })
  } catch (error) {
    console.error('Error updating order:', error)
    throw error
  }
}

export async function deleteOrder(orderId: string) {
  try {
    console.log('🗑️ Eliminando orden y recuperando stock:', orderId);

    // Buscar y eliminar movimientos de stock asociados a esta orden (Recuperación)
    try {
      const movementsRef = collection(db, 'ingredientStockMovements')
      const q = query(movementsRef, where('orderId', '==', orderId))
      const snapshot = await getDocs(q)

      if (!snapshot.empty) {
        console.log(`♻️ Recuperando stock de ${snapshot.size} ingredientes...`);
        const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref))
        await Promise.all(deletePromises)
      }
    } catch (revertError) {
      console.error('Error al recuperar stock:', revertError)
    }

    const docRef = doc(db, 'orders', orderId)
    await deleteDoc(docRef)
    console.log('✅ Orden eliminada y stock recuperado');
  } catch (error) {
    console.error('❌ Error al eliminar orden:', error);
    throw error;
  }
}

// Función para obtener información del repartidor
export async function getDelivery(deliveryId: string): Promise<Delivery | null> {
  try {
    console.log('🔍 Getting delivery person:', deliveryId);

    const docRef = doc(db, 'deliveries', deliveryId)
    const docSnap = await getDoc(docRef)

    if (docSnap.exists()) {
      const deliveryData = docSnap.data()
      const delivery: Delivery = {
        id: docSnap.id,
        nombres: deliveryData.nombres || '',
        celular: deliveryData.celular || '',
        email: deliveryData.email || '',
        fotoUrl: deliveryData.fotoUrl || '',
        estado: deliveryData.estado || 'inactivo',
        fechaRegistro: deliveryData.fechaRegistro || '',
        uid: deliveryData.uid || ''
      }

      console.log('✅ Delivery person found:', delivery);
      return delivery
    }

    console.log('❌ No delivery person found with ID:', deliveryId);
    return null
  } catch (error) {
    console.error('Error getting delivery person:', error)
    throw error
  }
}

// Funciones para subir imágenes
export async function uploadImage(file: File, path: string): Promise<string> {
  try {
    const storageRef = ref(storage, path)
    const snapshot = await uploadBytes(storageRef, file)
    const downloadURL = await getDownloadURL(snapshot.ref)
    return downloadURL
  } catch (error) {
    console.error('Error uploading image:', error)
    throw error
  }
}

// Función para buscar negocios por categoría o nombre
export async function searchBusinesses(searchTerm: string, category?: string): Promise<Business[]> {
  try {
    const q = collection(db, 'businesses')
    const querySnapshot = await getDocs(q)
    let businesses = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: toSafeDate(doc.data().createdAt)
    })) as Business[]

    // Filtrar por categoría
    if (category && category !== 'all') {
      businesses = businesses.filter(business =>
        business.categories && business.categories.includes(category)
      )
    }

    // Filtrar por término de búsqueda
    if (searchTerm) {
      businesses = businesses.filter(business =>
        business.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        business.description.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    return businesses
  } catch (error) {
    console.error('Error searching businesses:', error)
    throw error
  }
}

// Funciones para Categorías de Negocios
export async function addCategoryToBusiness(businessId: string, categoryName: string) {
  try {
    const businessRef = doc(db, 'businesses', businessId)
    const businessSnap = await getDoc(businessRef)

    if (!businessSnap.exists()) {
      throw new Error('Negocio no encontrado')
    }

    const businessData = businessSnap.data() as Business
    const currentCategories = businessData.categories || []

    // Evitar categorías duplicadas
    if (currentCategories.includes(categoryName)) {
      throw new Error('Esta categoría ya existe')
    }

    const updatedCategories = [...currentCategories, categoryName]

    await updateDoc(businessRef, {
      categories: updatedCategories,
      updatedAt: serverTimestamp()
    })

    return updatedCategories
  } catch (error) {
    console.error('Error adding category:', error)
    throw error
  }
}

export async function removeCategoryFromBusiness(businessId: string, categoryName: string) {
  try {
    const businessRef = doc(db, 'businesses', businessId)
    const businessSnap = await getDoc(businessRef)

    if (!businessSnap.exists()) {
      throw new Error('Negocio no encontrado')
    }

    const businessData = businessSnap.data() as Business
    const currentCategories = businessData.categories || []

    const updatedCategories = currentCategories.filter(cat => cat !== categoryName)

    await updateDoc(businessRef, {
      categories: updatedCategories,
      updatedAt: serverTimestamp()
    })

    return updatedCategories
  } catch (error) {
    console.error('Error removing category:', error)
    throw error
  }
}

export async function getBusinessCategories(businessId: string): Promise<string[]> {
  try {
    const businessRef = doc(db, 'businesses', businessId)
    const businessSnap = await getDoc(businessRef)

    if (!businessSnap.exists()) {
      return []
    }

    const businessData = businessSnap.data() as Business
    return businessData.categories || []
  } catch (error) {
    console.error('Error getting business categories:', error)
    return []
  }
}

// Funciones de Autenticación con Google
export async function signInWithGoogle(): Promise<UserCredential> {
  try {
    // Usar popup para obtener el resultado directamente
    return await signInWithPopup(auth, googleProvider);
  } catch (error: any) {
    console.error('Error signing in with Google:', error);
    throw new Error(`Error al iniciar sesión con Google: ${error.message}`);
  }
}

// Función para manejar el resultado del redirect
export async function handleGoogleRedirectResult() {
  try {
    console.log('🔍 Getting redirect result...');
    const result = await getRedirectResult(auth);

    if (result?.user) {
      console.log('✅ Redirect result found for user:', result.user.email);
      console.log('🆔 User UID from redirect:', result.user.uid);

      // Verificar acceso completo del usuario (propietario o administrador)
      console.log('🔍 Checking user business access...');
      const businessAccess = await getUserBusinessAccess(
        result.user.email || '',
        result.user.uid
      );

      console.log('🏢 Business access result:', {
        owned: businessAccess.ownedBusinesses.length,
        admin: businessAccess.adminBusinesses.length,
        hasAccess: businessAccess.hasAccess
      });

      // Determinar businessId preferido (primero propias, luego como admin)
      let preferredBusinessId = null;
      if (businessAccess.ownedBusinesses.length > 0) {
        preferredBusinessId = businessAccess.ownedBusinesses[0].id;
      } else if (businessAccess.adminBusinesses.length > 0) {
        preferredBusinessId = businessAccess.adminBusinesses[0].id;
      }

      return {
        user: result.user,
        hasBusinessProfile: businessAccess.ownedBusinesses.length > 0,
        isAdministrator: businessAccess.adminBusinesses.length > 0,
        hasAccess: businessAccess.hasAccess,
        businessId: preferredBusinessId,
        ownedBusinesses: businessAccess.ownedBusinesses,
        adminBusinesses: businessAccess.adminBusinesses
      }
    } else {
      console.log('ℹ️ No redirect result found');
      return null;
    }

  } catch (error: any) {
    // Si el error es porque no hay redirect result, no es realmente un error
    if (error.code === 'auth/no-auth-event') {
      console.log('ℹ️ No auth event found (normal if not coming from redirect)');
      return null;
    }

    console.error('❌ Error handling Google redirect result:', error);
    throw new Error(`Error al procesar resultado de Google: ${error.message}`)
  }
}

export async function createBusinessFromGoogleAuth(userData: {
  name: string
  username?: string
  phone: string
  address: string
  description?: string
}) {
  try {
    const user = auth.currentUser
    if (!user) {
      throw new Error('Usuario no autenticado')
    }

    const businessData = {
      name: userData.name,
      username: userData.username || `user_${user.uid.slice(0, 8)}`, // Generate username if not provided
      phone: userData.phone,
      address: userData.address,
      description: userData.description || '',
      email: user.email || '',
      ownerId: user.uid,
      categories: [] as string[],
      mapLocation: {
        lat: 0,
        lng: 0
      },
      references: '',
      schedule: {
        monday: { open: '09:00', close: '18:00', isOpen: true },
        tuesday: { open: '09:00', close: '18:00', isOpen: true },
        wednesday: { open: '09:00', close: '18:00', isOpen: true },
        thursday: { open: '09:00', close: '18:00', isOpen: true },
        friday: { open: '09:00', close: '18:00', isOpen: true },
        saturday: { open: '09:00', close: '18:00', isOpen: true },
        sunday: { open: '09:00', close: '18:00', isOpen: false }
      },
      isActive: true,
      updatedAt: new Date()
    }

    const businessId = await createBusiness(businessData)
    return businessId
  } catch (error) {
    console.error('Error creating business from Google auth:', error)
    throw error
  }
}

// Definir el tipo para el cliente desde Firestore
export interface FirestoreClient {
  id: string;
  nombres: string;
  celular: string;
  email?: string;
  fecha_de_registro?: string;
  createdAt?: any;
  updatedAt?: any;
  pinHash?: string | null;
  photoURL?: string; // URL de la imagen de perfil del usuario
}

export interface ClientLocation {
  id: string;
  id_cliente: string;
  referencia: string;
  sector: string;
  tarifa: string;
  latlong: string;
  photo?: string;
}

// Nueva función para obtener un negocio por su username
export async function getBusinessByUsername(username: string): Promise<Business | null> {
  try {
    console.log('🔍 Searching business by username:', username);

    const q = query(
      collection(db, 'businesses'),
      where('username', '==', username),
      limit(1)
    );

    const querySnapshot = await getDocs(q);
    console.log('📊 Query results:', querySnapshot.size, 'documents found');

    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      const businessData = doc.data();
      console.log('✅ Business found:', businessData);
      const business: Business = {
        id: doc.id,
        ...businessData,
        createdAt: toSafeDate(businessData.createdAt),
        updatedAt: toSafeDate(businessData.updatedAt)
      } as Business;

      console.log('✅ Business found:', business);
      return business;
    }

    console.log('❌ No business found with username:', username);
    return null;
  } catch (error) {
    console.error('Error searching business by username:', error);
    throw error;
  }
}

/**
 * Obtener un cliente por su ID
 */
export async function getClientById(clientId: string): Promise<FirestoreClient | null> {
  try {
    const docSnap = await getDoc(doc(db, 'clients', clientId))
    if (docSnap.exists()) {
      const data = docSnap.data()
      return {
        id: docSnap.id,
        nombres: data.nombres || '',
        celular: data.celular || '',
        email: data.email || '',
        photoURL: data.photoURL || '',
        fecha_de_registro: data.fecha_de_registro || '',
        pinHash: data.pinHash || null
      } as FirestoreClient
    }
    return null
  } catch (error) {
    console.error('Error getting client by ID:', error)
    return null
  }
}

// Nueva función para obtener ubicaciones del cliente
export async function getClientLocations(clientId: string): Promise<ClientLocation[]> {
  try {
    console.log('🔍 Getting client locations for client ID:', clientId);

    const q = query(
      collection(db, 'ubicaciones'),
      where('id_cliente', '==', clientId)
    );

    const querySnapshot = await getDocs(q);
    const locations: ClientLocation[] = [];

    querySnapshot.forEach((doc) => {
      const locationData = doc.data();
      locations.push({
        id: doc.id,
        id_cliente: locationData.id_cliente || '',
        referencia: locationData.referencia || '',
        sector: locationData.sector || '',
        tarifa: locationData.tarifa || '',
        latlong: locationData.latlong || '',
        photo: locationData.photo || ''
      });
    });

    console.log(`✅ Found ${locations.length} locations for client:`, locations);
    return locations;
  } catch (error) {
    // Si hay un error de permisos u otro, devolver un array vacío para
    // que el flujo de checkout no se rompa en el cliente.
    console.error('Error getting client locations (returning empty list):', error);
    return [];
  }
}

// Nueva función para buscar clientes por teléfono
export async function searchClientByPhone(phone: string): Promise<FirestoreClient | null> {
  try {
    console.log('🔍 Searching client by phone:', phone);

    const q = query(
      collection(db, 'clients'),
      where('celular', '==', phone),
      limit(1)
    );

    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      const clientData = doc.data();
      const client: FirestoreClient = {
        id: doc.id,
        nombres: clientData.nombres || '',
        celular: clientData.celular || phone,
        email: clientData.email || '',
        photoURL: clientData.photoURL || '',
        fecha_de_registro: clientData.fecha_de_registro || new Date().toISOString(),
        pinHash: clientData.pinHash || null
      };

      console.log('✅ Client found:', client);
      return client;
    }

    console.log('❌ No client found with phone:', phone);
    return null;
  } catch (error) {
    console.error('Error searching client by phone:', error);
    throw error;
  }
}

export async function verifyClientName(phone: string): Promise<string | null> {
  try {
    console.log('🔍 Verifying client name by phone:', phone);

    const q = query(
      collection(db, 'clients'),
      where('celular', '==', phone),
      limit(1)
    );

    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      console.log('✅ Client name found:', doc.data().nombres);
      return doc.data().nombres || null;
    }

    console.log('❌ No client found with phone:', phone);
    return null;
  } catch (error) {
    console.error('Error verifying client name by phone:', error);
    throw error;
  }
}

// Establecer o actualizar el pinHash de un cliente
export async function setClientPin(clientId: string, pinHash: string) {
  try {
    console.log('🔐 Setting PIN for client:', clientId)
    const clientRef = doc(db, 'clients', clientId)
    await updateDoc(clientRef, { pinHash, updatedAt: serverTimestamp() })
    return true
  } catch (error) {
    console.error('❌ Error setting client PIN:', error)
    throw error
  }
}

// Limpiar el PIN del cliente (dejarlo en null)
export async function clearClientPin(clientId: string) {
  try {
    console.log('🧹 Clearing PIN for client:', clientId)
    const clientRef = doc(db, 'clients', clientId)
    await updateDoc(clientRef, { pinHash: null, updatedAt: serverTimestamp() })
    return true
  } catch (error) {
    console.error('❌ Error clearing client PIN:', error)
    throw error
  }
}

// Registrar evento de olvido de PIN en el cliente
export async function registerClientForgotPin(clientId: string) {
  try {
    console.log('📝 Registering forgot PIN event for client:', clientId)
    const clientRef = doc(db, 'clients', clientId)
    await updateDoc(clientRef, {
      forgotPinCount: firestoreIncrement(1),
      lastForgotPinAt: serverTimestamp()
    })
    return true
  } catch (error) {
    console.error('❌ Error registering forgot PIN event:', error)
    throw error
  }
}

export async function createClient(clientData: { celular: string; nombres: string; fecha_de_registro?: string; id?: string; pinHash?: string }) {
  try {
    console.log('📝 Creating client:', clientData);

    // Formatear fecha_de_registro como DD/MM/YYYY para mantener compatibilidad con la base histórica
    // Usar el helper superior `formatDateDDMMYYYY` definido en el módulo

    const payload: any = {
      celular: clientData.celular,
      nombres: clientData.nombres,
      fecha_de_registro: clientData.fecha_de_registro || formatDateDDMMYYYY(),
      id: clientData.id || ''
    };

    if (clientData.pinHash) {
      payload.pinHash = clientData.pinHash
    }

    const clientRef = await addDoc(collection(db, 'clients'), payload);

    // Ensure the document has the correct id field
    await updateDoc(doc(db, 'clients', clientRef.id), { id: clientRef.id });

    console.log('✅ Client created with ID:', clientRef.id);
    return {
      id: clientRef.id,
      celular: clientData.celular,
      nombres: clientData.nombres,
      fecha_de_registro: payload.fecha_de_registro,
      pinHash: clientData.pinHash
    } as any;
  } catch (error) {
    console.error('❌ Error creating client:', error);
    throw error;
  }
}

export async function updateClient(clientId: string, clientData: { celular?: string; nombres?: string; email?: string; photoURL?: string }) {
  try {
    console.log('📝 Updating client:', clientId, clientData);

    const clientRef = doc(db, 'clients', clientId);
    const updateData: any = {};

    if (clientData.celular) updateData.celular = clientData.celular;
    if (clientData.nombres) updateData.nombres = clientData.nombres;
    if (clientData.email !== undefined) updateData.email = clientData.email;
    if (clientData.photoURL !== undefined) updateData.photoURL = clientData.photoURL;

    await updateDoc(clientRef, updateData);
    console.log('✅ Client updated successfully');

    return true;
  } catch (error) {
    console.error('❌ Error updating client:', error);
    throw error;
  }
}

export async function getOrdersByClient(clientPhone: string): Promise<any[]> {
  try {
    console.log('🔍 Getting orders for client phone:', clientPhone);

    const q = query(
      collection(db, 'orders'),
      where('customer.phone', '==', clientPhone),
      orderBy('createdAt', 'desc')
    );

    const querySnapshot = await getDocs(q);
    console.log('📊 Orders found:', querySnapshot.size);

    const orders = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: toSafeDate(doc.data().createdAt),
      updatedAt: toSafeDate(doc.data().updatedAt)
    }));

    return orders;
  } catch (error) {
    console.error('❌ Error getting orders by client:', error);
    throw error;
  }
}

export async function getLocationsByClient(clientPhone: string): Promise<ClientLocation[]> {
  try {
    console.log('🔍 Getting locations for client phone:', clientPhone);

    // Primero encontrar el ID del cliente usando su número de celular
    const clientQuery = query(
      collection(db, 'clients'),
      where('celular', '==', clientPhone)
    );

    const clientSnapshot = await getDocs(clientQuery);

    if (clientSnapshot.empty) {
      console.log('❌ No client found with phone:', clientPhone);
      return [];
    }

    const clientDoc = clientSnapshot.docs[0];
    const clientId = clientDoc.data().id;
    console.log('✅ Client found, ID:', clientId);

    // Ahora buscar las ubicaciones usando el ID del cliente
    const locationQuery = query(
      collection(db, 'ubicaciones'),
      where('id_cliente', '==', clientId)
    );

    const querySnapshot = await getDocs(locationQuery);
    console.log('📊 Locations found:', querySnapshot.size);

    const locations = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as ClientLocation[];

    return locations;
  } catch (error) {
    console.error('❌ Error getting locations by client:', error);
    throw error;
  }
}

export async function deleteLocation(locationId: string): Promise<void> {
  try {
    console.log('🗑️ Deleting location:', locationId);
    await deleteDoc(doc(db, 'ubicaciones', locationId));
    console.log('✅ Location deleted successfully');
  } catch (error) {
    console.error('❌ Error deleting location:', error);
    throw error;
  }
}

export async function updateLocation(locationId: string, locationData: Partial<ClientLocation>): Promise<void> {
  try {
    console.log('📝 Updating location:', locationId, locationData);
    const locationRef = doc(db, 'ubicaciones', locationId);
    await updateDoc(locationRef, locationData);
    console.log('✅ Location updated successfully');
  } catch (error) {
    console.error('❌ Error updating location:', error);
    throw error;
  }
}

// Función para crear nueva ubicación de cliente
export async function createClientLocation(locationData: { id_cliente: string, latlong: string, referencia: string, tarifa: string, sector: string, photo?: string }): Promise<string> {
  try {
    console.log('📍 Creating new client location:', locationData);

    // Si id_cliente parece ser un número de teléfono, necesitamos convertirlo al ID real
    let clientId = locationData.id_cliente;

    // Si parece ser un número de celular, buscar el ID real del cliente
    if (locationData.id_cliente.length > 8 && /^\d+$/.test(locationData.id_cliente)) {
      console.log('🔍 Converting phone number to client ID:', locationData.id_cliente);

      const clientQuery = query(
        collection(db, 'clients'),
        where('celular', '==', locationData.id_cliente)
      );

      const clientSnapshot = await getDocs(clientQuery);

      if (!clientSnapshot.empty) {
        const clientDoc = clientSnapshot.docs[0];
        clientId = clientDoc.data().id;
        console.log('✅ Found client ID:', clientId);
      } else {
        console.log('❌ No client found with phone:', locationData.id_cliente);
        throw new Error('Cliente no encontrado');
      }
    }

    const cleanedData = cleanObject({
      id_cliente: clientId,
      latlong: locationData.latlong,
      referencia: locationData.referencia,
      tarifa: locationData.tarifa,
      sector: locationData.sector || 'Sin especificar',
      ...(locationData.photo && { photo: locationData.photo }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const docRef = await addDoc(collection(db, 'ubicaciones'), cleanedData);
    console.log('✅ Client location created with ID:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('❌ Error creating client location:', error);
    throw error;
  }
}

// Función para obtener todas las tiendas de un usuario
export async function getBusinessesByOwner(ownerId: string): Promise<Business[]> {
  try {
    console.log('🔍 Getting businesses for owner ID:', ownerId);

    const q = query(
      collection(db, 'businesses'),
      where('ownerId', '==', ownerId),
      orderBy('createdAt', 'desc')
    );

    const querySnapshot = await getDocs(q);
    const businesses: Business[] = [];

    querySnapshot.forEach((doc) => {
      const businessData = doc.data();
      businesses.push({
        id: doc.id,
        ...businessData,
        createdAt: toSafeDate(businessData.createdAt),
        updatedAt: toSafeDate(businessData.updatedAt)
      } as Business);
    });

    console.log(`✅ Found ${businesses.length} businesses for owner:`, businesses);
    return businesses;
  } catch (error) {
    console.error('❌ Error getting businesses by owner:', error);
    throw error;
  }
}

// --- Visitas (métricas) ---

/**
 * Incrementa el contador de visitas para un negocio en Firestore.
 * Crea el documento si no existe con count = 1.
 */
export async function incrementVisitFirestore(businessId: string, count: number = 1) {
  if (!businessId) throw new Error('businessId is required')
  if (count <= 0) return false
  try {
    const visitRef = doc(db, 'visits', businessId)

    // Intentar hacer update con increment; si falla porque no existe, crear el doc
    try {
      await updateDoc(visitRef, {
        count: firestoreIncrement(count),
        updatedAt: serverTimestamp()
      })
      return true
    } catch (e) {
      // Si no existe, crear con count = count
      await setDoc(visitRef, {
        count: count,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      return true
    }
  } catch (error) {
    console.error('Error incrementing visit in Firestore:', error)
    throw error
  }
}

export async function getVisitsForBusiness(businessId: string): Promise<number> {
  try {
    const visitRef = doc(db, 'visits', businessId)
    const snap = await getDoc(visitRef)
    if (!snap.exists()) return 0
    const data = snap.data()
    return parseInt(data.count || 0, 10) || 0
  } catch (error) {
    console.error('Error getting visits from Firestore:', error)
    return 0
  }
}
// --- end visitas ---

// Función para verificar si un usuario es administrador de alguna tienda
export async function getBusinessesByAdministrator(userEmail: string): Promise<Business[]> {
  try {
    console.log('🔍 Checking if user is administrator:', userEmail);

    const q = query(
      collection(db, 'businesses'),
      where('administrators', 'array-contains-any', [
        { email: userEmail }
      ])
    );

    // Como array-contains-any no funciona con objetos complejos, 
    // necesitamos obtener todas las tiendas y filtrar manualmente
    const allBusinessesQuery = query(collection(db, 'businesses'));
    const querySnapshot = await getDocs(allBusinessesQuery);

    const adminBusinesses: Business[] = [];

    querySnapshot.docs.forEach(doc => {
      const businessData = doc.data();
      const administrators = businessData.administrators || [];

      // Verificar si el usuario es administrador
      const isAdmin = administrators.some((admin: any) => admin.email === userEmail);

      if (isAdmin) {
        adminBusinesses.push({
          id: doc.id,
          ...businessData,
          createdAt: toSafeDate(businessData.createdAt),
          updatedAt: toSafeDate(businessData.updatedAt),
          administrators: administrators
        } as Business);
      }
    });

    console.log(`✅ Found ${adminBusinesses.length} businesses where user is administrator`);
    return adminBusinesses;
  } catch (error) {
    console.error('❌ Error getting businesses by administrator:', error);
    throw error;
  }
}

// Función para verificar si un usuario tiene acceso a alguna tienda (como propietario o administrador)
export async function getUserBusinessAccess(userEmail: string, userId: string): Promise<{
  ownedBusinesses: Business[];
  adminBusinesses: Business[];
  hasAccess: boolean;
}> {
  try {
    console.log('🔍 Checking user business access for:', userEmail, userId);

    // Verificar tiendas como propietario
    const ownedBusinesses = await getBusinessesByOwner(userId);

    // Verificar tiendas como administrador
    const adminBusinesses = await getBusinessesByAdministrator(userEmail);

    const hasAccess = ownedBusinesses.length > 0 || adminBusinesses.length > 0;

    console.log('✅ User business access:', {
      owned: ownedBusinesses.length,
      admin: adminBusinesses.length,
      hasAccess
    });

    return {
      ownedBusinesses,
      adminBusinesses,
      hasAccess
    };
  } catch (error) {
    console.error('❌ Error checking user business access:', error);
    throw error;
  }
}

// Funciones para Zonas de Cobertura
export async function getCoverageZones(businessId?: string): Promise<CoverageZone[]> {
  try {
    let q;
    if (businessId) {
      // Obtener zonas específicas del negocio
      q = query(
        collection(db, 'coverageZones'),
        where('businessId', '==', businessId),
        orderBy('name')
      );
    } else {
      // Obtener zonas globales (para admin)
      q = query(
        collection(db, 'coverageZones'),
        orderBy('name')
      );
    }

    const querySnapshot = await getDocs(q);
    const zones: CoverageZone[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();

      // Helper function to safely convert dates
      const convertToDate = (dateField: any): Date => {
        if (!dateField) return new Date();
        if (dateField.toDate && typeof dateField.toDate === 'function') {
          return dateField.toDate();
        }
        if (dateField instanceof Date) {
          return dateField;
        }
        if (typeof dateField === 'string' || typeof dateField === 'number') {
          return new Date(dateField);
        }
        return new Date();
      };

      zones.push({
        id: doc.id,
        name: data.name || '',
        businessId: data.businessId || null,
        polygon: data.polygon || [],
        deliveryFee: data.deliveryFee || 0,
        isActive: data.isActive !== false,
        createdAt: convertToDate(data.createdAt),
        updatedAt: convertToDate(data.updatedAt)
      });
    });

    return zones;
  } catch (error) {
    console.error('Error getting coverage zones:', error);
    throw error;
  }
}

export async function createCoverageZone(zoneData: Omit<CoverageZone, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  try {
    const cleanedData = cleanObject({
      ...zoneData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const docRef = await addDoc(collection(db, 'coverageZones'), cleanedData);
    return docRef.id;
  } catch (error) {
    console.error('Error creating coverage zone:', error);
    throw error;
  }
}

export async function updateCoverageZone(zoneId: string, updates: Partial<CoverageZone>): Promise<void> {
  try {
    const cleanedUpdates = cleanObject({
      ...updates,
      updatedAt: serverTimestamp()
    });

    await updateDoc(doc(db, 'coverageZones', zoneId), cleanedUpdates);
  } catch (error) {
    console.error('Error updating coverage zone:', error);
    throw error;
  }
}

export async function deleteCoverageZone(zoneId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'coverageZones', zoneId));
  } catch (error) {
    console.error('Error deleting coverage zone:', error);
    throw error;
  }
}

// Función para verificar si una ubicación está dentro de una zona de cobertura
export function isPointInPolygon(point: { lat: number; lng: number }, polygon: { lat: number; lng: number }[]): boolean {
  let inside = false;
  const x = point.lng;
  const y = point.lat;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

// Función para obtener la tarifa de envío basada en la ubicación
export async function getDeliveryFeeForLocation(location: { lat: number; lng: number }, businessId?: string): Promise<number> {
  try {
    const zones = await getCoverageZones(businessId);

    // Buscar en zonas específicas del negocio primero, luego en zonas globales
    for (const zone of zones) {
      if (zone.isActive && isPointInPolygon(location, zone.polygon)) {
        return zone.deliveryFee;
      }
    }

    // Si no se encuentra en ninguna zona específica, buscar en zonas globales
    if (businessId) {
      const globalZones = await getCoverageZones();
      for (const zone of globalZones) {
        if (!zone.businessId && zone.isActive && isPointInPolygon(location, zone.polygon)) {
          return zone.deliveryFee;
        }
      }
    }

    // Si no está en ninguna zona, retornar tarifa por defecto o error
    return 0; // O lanzar error si prefieres que no haya entrega fuera de zonas
  } catch (error) {
    console.error('Error getting delivery fee for location:', error);
    throw error;
  }
}

// =============================================================================
// DELIVERIES FUNCTIONS
// =============================================================================

// Interfaz Delivery movida a src/types/index.ts para evitar duplicación

/**
 * Crear un nuevo delivery
 */
export async function createDelivery(deliveryData: Omit<Delivery, 'id'>): Promise<string> {
  try {
    const deliveryDoc = {
      ...deliveryData,
      fechaRegistro: new Date().toISOString(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }

    const docRef = await addDoc(collection(db, 'deliveries'), deliveryDoc)
    console.log('Delivery created successfully with ID:', docRef.id)
    return docRef.id
  } catch (error) {
    console.error('Error creating delivery:', error)
    throw error
  }
}

/**
 * Obtener todos los deliveries
 */
export async function getAllDeliveries(): Promise<Delivery[]> {
  try {
    const q = query(
      collection(db, 'deliveries'),
      orderBy('createdAt', 'desc')
    )

    const querySnapshot = await getDocs(q)
    const deliveries: Delivery[] = []

    querySnapshot.forEach((doc) => {
      const data = doc.data()
      deliveries.push({
        id: doc.id,
        nombres: data.nombres || '',
        celular: data.celular || '',
        email: data.email || '',
        fotoUrl: data.fotoUrl,
        estado: data.estado || 'activo',
        fechaRegistro: data.fechaRegistro || new Date().toISOString(),
        uid: data.uid
      })
    })

    return deliveries
  } catch (error) {
    console.error('Error getting deliveries:', error)
    return []
  }
}

/**
 * Obtener un delivery por ID
 */
export async function getDeliveryById(deliveryId: string): Promise<Delivery | null> {
  try {
    const docRef = doc(db, 'deliveries', deliveryId)
    const docSnap = await getDoc(docRef)

    if (docSnap.exists()) {
      const data = docSnap.data()
      return {
        id: docSnap.id,
        nombres: data.nombres || '',
        celular: data.celular || '',
        email: data.email || '',
        fotoUrl: data.fotoUrl,
        estado: data.estado || 'activo',
        fechaRegistro: data.fechaRegistro || new Date().toISOString(),
        uid: data.uid
      }
    }

    return null
  } catch (error) {
    console.error('Error getting delivery by ID:', error)
    return null
  }
}

/**
 * Actualizar un delivery
 */
export async function updateDelivery(deliveryId: string, updates: Partial<Delivery>): Promise<void> {
  try {
    const docRef = doc(db, 'deliveries', deliveryId)
    const updateData = {
      ...updates,
      updatedAt: serverTimestamp()
    }

    // Remover el ID del objeto de actualización si existe
    delete updateData.id

    await updateDoc(docRef, updateData)
    console.log('Delivery updated successfully')
  } catch (error) {
    console.error('Error updating delivery:', error)
    throw error
  }
}

/**
 * Cambiar el estado de un delivery
 */
export async function toggleDeliveryStatus(deliveryId: string): Promise<void> {
  try {
    const delivery = await getDeliveryById(deliveryId)
    if (!delivery) {
      throw new Error('Delivery not found')
    }

    const newStatus = delivery.estado === 'activo' ? 'inactivo' : 'activo'
    await updateDelivery(deliveryId, { estado: newStatus })
    console.log(`Delivery status changed to: ${newStatus}`)
  } catch (error) {
    console.error('Error toggling delivery status:', error)
    throw error
  }
}

/**
 * Eliminar un delivery
 */
export async function deleteDelivery(deliveryId: string): Promise<void> {
  try {
    const docRef = doc(db, 'deliveries', deliveryId)
    await deleteDoc(docRef)
    console.log('Delivery deleted successfully')
  } catch (error) {
    console.error('Error deleting delivery:', error)
    throw error
  }
}

/**
 * Buscar deliveries por estado
 */
export async function getDeliveriesByStatus(estado: 'activo' | 'inactivo'): Promise<Delivery[]> {
  try {
    const q = query(
      collection(db, 'deliveries'),
      where('estado', '==', estado),
      orderBy('createdAt', 'desc')
    )

    const querySnapshot = await getDocs(q)
    const deliveries: Delivery[] = []

    querySnapshot.forEach((doc) => {
      const data = doc.data()
      deliveries.push({
        id: doc.id,
        nombres: data.nombres || '',
        celular: data.celular || '',
        email: data.email || '',
        fotoUrl: data.fotoUrl,
        estado: data.estado || 'activo',
        fechaRegistro: data.fechaRegistro || new Date().toISOString(),
        uid: data.uid
      })
    })

    return deliveries
  } catch (error) {
    // En caso de errores (p. ej. permisos), devolver lista vacía para que la UI
    // no falle y se pueda mostrar un mensaje o estado vacío.
    console.error('Error getting deliveries by status (returning empty list):', error)
    return []
  }
}

/**
 * Obtener delivery por email
 */
export async function getDeliveryByEmail(email: string): Promise<Delivery | null> {
  try {
    const q = query(
      collection(db, 'deliveries'),
      where('email', '==', email),
      limit(1)
    )

    const querySnapshot = await getDocs(q)

    if (querySnapshot.empty) {
      return null
    }

    const doc = querySnapshot.docs[0]
    const data = doc.data()

    return {
      id: doc.id,
      nombres: data.nombres || '',
      celular: data.celular || '',
      email: data.email || '',
      fotoUrl: data.fotoUrl,
      estado: data.estado || 'activo',
      fechaRegistro: data.fechaRegistro || new Date().toISOString(),
      uid: data.uid
    }
  } catch (error) {
    console.error('Error getting delivery by email:', error)
    return null
  }
}

/**
 * Obtener pedidos asignados a un delivery específico
 */
export async function getOrdersByDelivery(deliveryId: string): Promise<Order[]> {
  try {
    console.log('[getOrdersByDelivery] Buscando pedidos para deliveryId:', deliveryId)

    // Primero intentar con orderBy (requiere índice compuesto)
    let q = query(
      collection(db, 'orders'),
      where('delivery.assignedDelivery', '==', deliveryId),
      where('status', '!=', 'cancelled'),
      orderBy('createdAt', 'desc')
    )

    let querySnapshot
    try {
      querySnapshot = await getDocs(q)
    } catch (indexError: any) {
      // Si falla por falta de índice, hacer consulta sin orderBy y ordenar en memoria
      console.warn('Índice compuesto no encontrado, ordenando en memoria:', indexError.message)
      q = query(
        collection(db, 'orders'),
        where('delivery.assignedDelivery', '==', deliveryId),
        where('status', '!=', 'cancelled')
      )
      querySnapshot = await getDocs(q)
    }

    console.log('[getOrdersByDelivery] Documentos encontrados:', querySnapshot.size)

    const orders: Order[] = []

    querySnapshot.forEach((doc) => {
      const data = doc.data()

      // Función helper para convertir fechas de manera segura
      const toDate = (field: any): Date => {
        if (!field) return new Date()
        if (field.toDate && typeof field.toDate === 'function') {
          return field.toDate()
        }
        if (field instanceof Date) return field
        if (typeof field === 'string') return new Date(field)
        if (typeof field === 'number') return new Date(field)
        return new Date()
      }

      orders.push({
        id: doc.id,
        businessId: data.businessId,
        customer: data.customer,
        items: data.items || [],
        delivery: data.delivery,
        timing: data.timing,
        payment: data.payment,
        total: data.total,
        subtotal: data.subtotal,
        status: data.status,
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
        createdByAdmin: data.createdByAdmin
      })
    })

    // Ordenar en memoria si no se pudo hacer en la consulta
    orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return orders
  } catch (error) {
    console.error('Error getting orders by delivery:', error)
    return []
  }
}

/**
 * Vincular un delivery con su UID de Firebase Auth
 */
export async function linkDeliveryWithAuth(deliveryId: string, uid: string): Promise<void> {
  try {
    const docRef = doc(db, 'deliveries', deliveryId)
    await updateDoc(docRef, {
      uid: uid,
      updatedAt: serverTimestamp()
    })
    console.log('Delivery linked with auth UID:', uid)
  } catch (error) {
    console.error('Error linking delivery with auth:', error)
    throw error
  }
}

// ==================== BIBLIOTECA DE INGREDIENTES ====================

export interface IngredientLibraryItem {
  id: string
  name: string
  unitCost: number
  lastUsed: Date
  usageCount: number
}

/**
 * Obtener la biblioteca de ingredientes de un negocio
 */
export async function getIngredientLibrary(businessId: string): Promise<IngredientLibraryItem[]> {
  try {
    const libraryRef = collection(db, 'businesses', businessId, 'ingredientLibrary')
    const q = query(libraryRef, orderBy('name', 'asc'))
    const snapshot = await getDocs(q)

    const ingredients: IngredientLibraryItem[] = []
    snapshot.forEach((doc) => {
      const data = doc.data()
      ingredients.push({
        id: doc.id,
        name: data.name,
        unitCost: data.unitCost,
        lastUsed: toSafeDate(data.lastUsed),
        usageCount: data.usageCount || 0
      })
    })

    return ingredients
  } catch (error) {
    console.error('Error getting ingredient library:', error)
    return []
  }
}

/**
 * Agregar o actualizar un ingrediente en la biblioteca
 */
export async function addOrUpdateIngredientInLibrary(
  businessId: string,
  name: string,
  unitCost: number
): Promise<void> {
  try {
    const libraryRef = collection(db, 'businesses', businessId, 'ingredientLibrary')

    // Buscar si ya existe un ingrediente con ese nombre (case-insensitive)
    const q = query(libraryRef, where('name', '==', name.trim()))
    const snapshot = await getDocs(q)

    if (snapshot.empty) {
      // Crear nuevo ingrediente
      await addDoc(libraryRef, {
        name: name.trim(),
        unitCost: unitCost,
        lastUsed: serverTimestamp(),
        usageCount: 1,
        createdAt: serverTimestamp()
      })
    } else {
      // Actualizar existente
      const docRef = doc(db, 'businesses', businessId, 'ingredientLibrary', snapshot.docs[0].id)
      await updateDoc(docRef, {
        unitCost: unitCost,
        lastUsed: serverTimestamp(),
        usageCount: firestoreIncrement(1)
      })
    }
  } catch (error) {
    console.error('Error adding/updating ingredient in library:', error)
    throw error
  }
}

/**
 * Actualizar un ingrediente específico de la biblioteca
 */
export async function updateIngredientLibraryItem(
  businessId: string,
  ingredientId: string,
  data: { name?: string; unitCost?: number }
): Promise<void> {
  try {
    const docRef = doc(db, 'businesses', businessId, 'ingredientLibrary', ingredientId)
    await updateDoc(docRef, {
      ...data,
      lastUsed: serverTimestamp()
    })
  } catch (error) {
    console.error('Error updating ingredient library item:', error)
    throw error
  }
}

/**
 * Eliminar un ingrediente de la biblioteca
 */
export async function deleteIngredientFromLibrary(businessId: string, ingredientId: string): Promise<void> {
  try {
    const docRef = doc(db, 'businesses', businessId, 'ingredientLibrary', ingredientId)
    await deleteDoc(docRef)
  } catch (error) {
    console.error('Error deleting ingredient from library:', error)
    throw error
  }
}

/**
 * Actualizar el costo de un ingrediente en la biblioteca
 */
export async function updateIngredientCostInLibrary(
  businessId: string,
  ingredientId: string,
  newCost: number
): Promise<void> {
  try {
    const docRef = doc(db, 'businesses', businessId, 'ingredientLibrary', ingredientId)
    await updateDoc(docRef, {
      unitCost: newCost,
      updatedAt: serverTimestamp()
    })
  } catch (error) {
    console.error('Error updating ingredient cost:', error)
    throw error
  }
}

// ==================== ANÁLISIS DE COSTOS Y REPORTES ====================

export interface IngredientConsumption {
  ingredientName: string
  totalQuantity: number
  unitCost: number
  totalCost: number
  usedInProducts: Array<{
    productName: string
    variantName?: string
    quantitySold: number
    ingredientQuantityUsed: number
  }>
}

export interface CostReport {
  startDate: Date
  endDate: Date
  totalRevenue: number
  totalIngredientCost: number
  totalShippingCost: number
  totalOrders: number
  profitMargin: number
  profitAmount: number
  ingredientConsumption: IngredientConsumption[]
  topSellingProducts: Array<{
    productName: string
    variantName?: string
    quantitySold: number
    revenue: number
    cost: number
    profit: number
  }>
}

/**
 * Calcular el consumo de ingredientes y costos basado en las órdenes
 */
export async function calculateCostReport(
  businessId: string,
  startDate: Date,
  endDate: Date
): Promise<CostReport> {
  try {
    // Obtener todas las órdenes del negocio (filtraremos por fecha de referencia abajo)
    const ordersRef = collection(db, 'orders')
    const q = query(
      ordersRef,
      where('businessId', '==', businessId),
      where('status', '!=', 'cancelled')
    )

    const ordersSnapshot = await getDocs(q)

    // Obtener todos los productos del negocio
    const productsSnapshot = await getDocs(
      query(collection(db, 'products'), where('businessId', '==', businessId))
    )

    const productsMap = new Map<string, any>()
    productsSnapshot.forEach(doc => {
      productsMap.set(doc.id, { id: doc.id, ...doc.data() })
    })

    // Estructuras para acumular datos
    const ingredientConsumptionMap = new Map<string, IngredientConsumption>()
    const productSalesMap = new Map<string, any>()
    let totalRevenue = 0
    let totalOrders = 0
    let totalShippingCost = 0

    // Helper para obtener la fecha de referencia de una orden
    const toDateSafe = (d: any) => {
      if (!d) return new Date(0)
      if (d instanceof Date) return d
      if (typeof d === 'object' && typeof d.toDate === 'function') return d.toDate()
      if (typeof d === 'object' && 'seconds' in d && typeof d.seconds === 'number') {
        return new Date(d.seconds * 1000)
      }
      return new Date(d)
    }

    // Procesar cada orden y filtrar por fecha de referencia (scheduledDate para órdenes programadas)
    ordersSnapshot.forEach(orderDoc => {
      const order = orderDoc.data() as any
      // determinar fecha de referencia
      let orderRefDate = toDateSafe(order.createdAt)
      try {
        if (order?.timing?.type === 'scheduled' && order?.timing?.scheduledDate) {
          orderRefDate = toDateSafe(order.timing.scheduledDate)
        }
      } catch (e) {
        // fallback ya fue asignado a createdAt
      }

      if (!(orderRefDate >= startDate && orderRefDate <= endDate)) {
        return // omitir ordenes fuera del rango de fechas
      }

      totalOrders++
      totalRevenue += order.total || 0

      // Calcular costo de envío para esta orden
      if (order.delivery?.type === 'delivery') {
        totalShippingCost += order.delivery?.deliveryCost || 0
      }

      // Procesar cada item de la orden
      order.items?.forEach((item: any) => {
        const product = productsMap.get(item.productId)
        if (!product) return

        const quantity = item.quantity || 1
        const variantName = item.variant || item.name
        const productKey = `${product.name}${variantName ? ` - ${variantName}` : ''}`

        // Acumular ventas por producto
        if (!productSalesMap.has(productKey)) {
          productSalesMap.set(productKey, {
            productName: product.name,
            variantName: variantName !== product.name ? variantName : undefined,
            quantitySold: 0,
            revenue: 0,
            cost: 0,
            profit: 0
          })
        }

        const productSale = productSalesMap.get(productKey)
        productSale.quantitySold += quantity
        productSale.revenue += (item.price || 0) * quantity

        // Determinar qué ingredientes usar (variante o producto base)
        let ingredientsToUse: any[] = []

        if (item.variant && product.variants) {
          // Buscar la variante específica
          const variant = product.variants.find((v: any) =>
            v.name === item.variant || v.name === variantName
          )
          if (variant?.ingredients) {
            ingredientsToUse = variant.ingredients
          }
        }

        // Si no hay ingredientes de variante, usar los del producto base
        if (ingredientsToUse.length === 0 && product.ingredients) {
          ingredientsToUse = product.ingredients
        }

        // Procesar ingredientes
        ingredientsToUse.forEach((ingredient: any) => {
          const ingredientName = ingredient.name
          const quantityUsed = ingredient.quantity * quantity
          const unitCost = ingredient.unitCost || 0
          const totalCost = quantityUsed * unitCost

          // Acumular consumo de ingredientes
          if (!ingredientConsumptionMap.has(ingredientName)) {
            ingredientConsumptionMap.set(ingredientName, {
              ingredientName,
              totalQuantity: 0,
              unitCost,
              totalCost: 0,
              usedInProducts: []
            })
          }

          const consumption = ingredientConsumptionMap.get(ingredientName)!
          consumption.totalQuantity += quantityUsed
          consumption.totalCost += totalCost
          consumption.usedInProducts.push({
            productName: product.name,
            variantName: variantName !== product.name ? variantName : undefined,
            quantitySold: quantity,
            ingredientQuantityUsed: quantityUsed
          })

          // Acumular costo en el producto
          productSale.cost += totalCost
        })

        // Calcular profit del producto
        productSale.profit = productSale.revenue - productSale.cost
      })
    })

    // Convertir maps a arrays y ordenar
    const ingredientConsumption = Array.from(ingredientConsumptionMap.values())
      .sort((a, b) => b.totalCost - a.totalCost)

    const topSellingProducts = Array.from(productSalesMap.values())
      .sort((a, b) => b.quantitySold - a.quantitySold)

    const totalIngredientCost = ingredientConsumption.reduce(
      (sum, ing) => sum + ing.totalCost, 0
    )

    const profitAmount = totalRevenue - totalIngredientCost
    const profitMargin = totalRevenue > 0 ? (profitAmount / totalRevenue) * 100 : 0

    return {
      startDate,
      endDate,
      totalRevenue,
      totalIngredientCost,
      totalShippingCost,
      totalOrders,
      profitMargin,
      profitAmount,
      ingredientConsumption,
      topSellingProducts
    }
  } catch (error) {
    console.error('Error calculating cost report:', error)
    throw error
  }
}

// ==================== RATING FUNCTIONS ====================

// Types for ratings
export interface BusinessRating {
  id?: string;
  businessId: string;
  orderId: string;
  rating: number;
  comment?: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  userAgent?: string;
  ipAddress?: string;
  createdAt: any;
  updatedAt: any;
}

/**
 * Save a rating for a business
 */
export async function saveBusinessRating(
  businessId: string,
  orderId: string,
  rating: number,
  comment: string = '',
  clientInfo: { name?: string; phone?: string; email?: string } = {}
): Promise<string> {
  try {
    const ratingsRef = collection(db, 'businesses', businessId, 'ratings');
    const ratingData: Omit<BusinessRating, 'id'> = {
      businessId,
      orderId,
      rating,
      comment,
      clientName: clientInfo.name || 'Cliente',
      clientPhone: clientInfo.phone || '',
      clientEmail: clientInfo.email || '',
      userAgent: typeof window !== 'undefined' ? navigator.userAgent : '',
      ipAddress: '', // Will be set by Firestore rules
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const docRef = await addDoc(ratingsRef, ratingData);

    // Update business rating stats
    await updateBusinessRatingStats(businessId);

    return docRef.id;
  } catch (error) {
    console.error('Error saving rating:', error);
    throw error;
  }
}

/**
 * Update business rating statistics
 */
async function updateBusinessRatingStats(businessId: string): Promise<void> {
  try {
    const ratingsRef = collection(db, 'businesses', businessId, 'ratings');
    const q = query(ratingsRef);
    const snapshot = await getDocs(q);

    let totalRating = 0;
    let ratingCount = 0;

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.rating) {
        totalRating += data.rating;
        ratingCount++;
      }
    });

    const averageRating = ratingCount > 0 ? totalRating / ratingCount : 0;

    // Update business document with new rating stats
    const businessRef = doc(db, 'businesses', businessId);
    await updateDoc(businessRef, {
      ratingAverage: averageRating,
      ratingCount,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error updating business rating stats:', error);
    throw error;
  }
}

/**
 * Get ratings for a business
 */
export async function getBusinessRatings(
  businessId: string,
  limitCount: number = 10
): Promise<BusinessRating[]> {
  try {
    const ratingsRef = collection(db, 'businesses', businessId, 'ratings');
    const q = query(
      ratingsRef,
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as BusinessRating[];
  } catch (error) {
    console.error('Error getting business ratings:', error);
    return [];
  }
}

/**
 * Check if an order has already been rated
 */
export async function hasOrderBeenRated(orderId: string): Promise<boolean> {
  try {
    // We need to search across all businesses' ratings
    // This is a limitation of Firestore - in a production app, you might want to 
    // maintain a separate collection for all ratings with an orderId index
    const businessesRef = collection(db, 'businesses');
    const businessesSnapshot = await getDocs(businessesRef);

    for (const businessDoc of businessesSnapshot.docs) {
      const ratingsRef = collection(db, 'businesses', businessDoc.id, 'ratings');
      const q = query(ratingsRef, where('orderId', '==', orderId), limit(1));
      const snapshot = await getCountFromServer(q);

      if (snapshot.data().count > 0) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking if order has been rated:', error);
    return false;
  }
}

// ==================== QR CODE FUNCTIONS ====================

// Eliminar un código QR
export async function deleteQRCode(qrCodeId: string): Promise<void> {
  try {
    const qrCodeRef = doc(db, 'qrCodes', qrCodeId);
    await deleteDoc(qrCodeRef);
  } catch (error) {
    console.error('Error al eliminar el código QR:', error);
    throw new Error('No se pudo eliminar el código QR');
  }
}

// Actualizar un código QR existente
export async function updateQRCode(qrCodeId: string, updates: Partial<QRCode>): Promise<void> {
  try {
    const qrCodeRef = doc(db, 'qrCodes', qrCodeId);
    await updateDoc(qrCodeRef, {
      ...updates,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error al actualizar el código QR:', error);
    throw new Error('No se pudo actualizar el código QR');
  }
}

/**
 * Crear un nuevo código QR
 */
export async function createQRCode(qrCode: Omit<QRCode, 'id' | 'createdAt'>): Promise<string> {
  try {
    const qrCodeData = {
      ...qrCode,
      createdAt: serverTimestamp()
    }
    const docRef = await addDoc(collection(db, 'qrCodes'), qrCodeData)
    return docRef.id
  } catch (error) {
    console.error('Error creating QR code:', error)
    throw error
  }
}

/**
 * Obtener todos los códigos QR de un negocio
 */
export async function getQRCodesByBusiness(businessId: string, includeInactive: boolean = false): Promise<QRCode[]> {
  try {
    const colRef = collection(db, 'qrCodes')
    const constraints = [where('businessId', '==', businessId)]

    if (!includeInactive) {
      constraints.push(where('isActive', '==', true))
    }

    const q = query(colRef, ...constraints)
    const snapshot = await getDocs(q)
    return snapshot.docs.map(doc => {
      const data = doc.data() as any
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate()
      } as QRCode
    })
  } catch (error) {
    console.error('Error getting QR codes:', error)
    throw error
  }
}

/**
 * Obtener un código QR por ID
 */
export async function getQRCodeById(qrCodeId: string): Promise<QRCode | null> {
  try {
    const docRef = doc(db, 'qrCodes', qrCodeId)
    const docSnap = await getDoc(docRef)

    if (!docSnap.exists()) {
      return null
    }

    return {
      id: docSnap.id,
      ...docSnap.data(),
      createdAt: docSnap.data().createdAt?.toDate() || new Date(),
      updatedAt: docSnap.data().updatedAt?.toDate()
    } as QRCode
  } catch (error) {
    console.error('Error getting QR code:', error)
    throw error
  }
}

/**
 * Obtener o crear el progreso de un usuario
 */
export async function getUserQRProgress(userId: string, businessId: string): Promise<UserQRProgress | null> {
  try {
    console.log('🔍 [getUserQRProgress] Buscando progreso QR para:', { userId, businessId })

    const q = query(
      collection(db, 'userQRProgress'),
      where('userId', '==', userId),
      where('businessId', '==', businessId),
      limit(1)
    )
    const snapshot = await getDocs(q)

    console.log('📊 [getUserQRProgress] Resultados encontrados:', snapshot.size)

    if (snapshot.empty) {
      console.log('❌ [getUserQRProgress] No se encontró progreso para userId:', userId)
      return null
    }

    const doc = snapshot.docs[0]
    const progressData = {
      userId: doc.data().userId,
      scannedCodes: doc.data().scannedCodes || [],
      completed: doc.data().completed || false,
      lastScanned: doc.data().lastScanned?.toDate(),
      rewardClaimed: doc.data().rewardClaimed || false,
      redeemedPrizeCodes: doc.data().redeemedPrizeCodes || [],
      completedRedemptions: doc.data().completedRedemptions || [],
      businessId: doc.data().businessId,
      createdAt: doc.data().createdAt?.toDate() || new Date(),
      updatedAt: doc.data().updatedAt?.toDate()
    } as UserQRProgress

    console.log('✅ [getUserQRProgress] Progreso encontrado:', {
      userId: progressData.userId,
      scannedCodesCount: progressData.scannedCodes.length,
      scannedCodes: progressData.scannedCodes,
      redeemedPrizeCodes: progressData.redeemedPrizeCodes
    })

    return progressData
  } catch (error) {
    console.error('❌ [getUserQRProgress] Error getting user QR progress:', error)
    throw error
  }
}

/**
 * Obtener TODO el progreso de un usuario (para todos los negocios)
 */
export async function getAllUserQRProgress(userId: string): Promise<UserQRProgress[]> {
  try {
    const q = query(
      collection(db, 'userQRProgress'),
      where('userId', '==', userId)
    )
    const snapshot = await getDocs(q)

    return snapshot.docs.map(doc => ({
      userId: doc.data().userId,
      scannedCodes: doc.data().scannedCodes || [],
      completed: doc.data().completed || false,
      lastScanned: doc.data().lastScanned?.toDate(),
      rewardClaimed: doc.data().rewardClaimed || false,
      redeemedPrizeCodes: doc.data().redeemedPrizeCodes || [],
      completedRedemptions: doc.data().completedRedemptions || [],
      businessId: doc.data().businessId,
      createdAt: doc.data().createdAt?.toDate() || new Date(),
      updatedAt: doc.data().updatedAt?.toDate()
    } as UserQRProgress))
  } catch (error) {
    console.error('Error getting all user QR progress:', error)
    return []
  }
}

/**
 * Marcar premios QR como completados permanentemente (cuando se finaliza una orden)
 * Esto mueve los IDs de redeemedPrizeCodes a completedRedemptions
 */
export async function completeQRRedemptions(userId: string, businessId: string, qrCodeIds: string[]): Promise<{
  success: boolean
  message: string
}> {
  try {
    console.log('🎁 [completeQRRedemptions] Marcando premios como completados:', { userId, businessId, qrCodeIds })

    if (!qrCodeIds || qrCodeIds.length === 0) {
      return { success: true, message: 'No hay premios para marcar' }
    }

    const q = query(
      collection(db, 'userQRProgress'),
      where('userId', '==', userId),
      where('businessId', '==', businessId),
      limit(1)
    )
    const snapshot = await getDocs(q)

    if (snapshot.empty) {
      console.log('⚠️ [completeQRRedemptions] No se encontró progreso para el usuario')
      return { success: false, message: 'No se encontró progreso del usuario' }
    }

    const docRef = snapshot.docs[0].ref
    const currentData = snapshot.docs[0].data()
    const currentCompleted = currentData.completedRedemptions || []
    const currentRedeemed = currentData.redeemedPrizeCodes || []

    // Agregar los nuevos IDs a completedRedemptions (evitando duplicados)
    const newCompleted = Array.from(new Set([...currentCompleted, ...qrCodeIds]))

    // Remover los IDs de redeemedPrizeCodes ya que ahora están completados
    const updatedRedeemed = currentRedeemed.filter((id: string) => !qrCodeIds.includes(id))

    await updateDoc(docRef, {
      completedRedemptions: newCompleted,
      redeemedPrizeCodes: updatedRedeemed,
      updatedAt: serverTimestamp()
    })

    console.log('✅ [completeQRRedemptions] Premios marcados como completados exitosamente')
    return { success: true, message: 'Premios marcados como completados' }
  } catch (error) {
    console.error('❌ [completeQRRedemptions] Error:', error)
    return { success: false, message: 'Error al marcar premios como completados' }
  }
}

export async function redeemQRCodePrize(userId: string, businessId: string, qrCodeId: string): Promise<{
  success: boolean
  message: string
}> {
  try {
    console.log('🎁 [redeemQRCodePrize] Intentando canjear premio:', { userId, businessId, qrCodeId })

    const progress = await getUserQRProgress(userId, businessId)

    if (!progress) {
      return { success: false, message: 'No tienes progreso registrado' }
    }

    if (!progress.scannedCodes?.includes(qrCodeId)) {
      return { success: false, message: 'Aún no has escaneado este código' }
    }

    // Verificar si ya fue completado permanentemente (en una orden anterior)
    const isCompleted = (progress.completedRedemptions || []).includes(qrCodeId)
    if (isCompleted) {
      console.log('⚠️ [redeemQRCodePrize] Premio ya fue canjeado en una orden anterior')
      return { success: false, message: 'Este premio ya fue canjeado anteriormente' }
    }

    // Verificar si ya está en el carrito actual
    const alreadyRedeemed = (progress.redeemedPrizeCodes || []).includes(qrCodeId)
    if (alreadyRedeemed) {
      console.log('⚠️ [redeemQRCodePrize] Premio ya está en el carrito')
      return { success: false, message: 'Este premio ya está en tu carrito' }
    }

    const q = query(
      collection(db, 'userQRProgress'),
      where('userId', '==', userId),
      where('businessId', '==', businessId),
      limit(1)
    )
    const snapshot = await getDocs(q)

    if (snapshot.empty) {
      return { success: false, message: 'No tienes progreso registrado' }
    }

    const docRef = snapshot.docs[0].ref
    const updated = [...(progress.redeemedPrizeCodes || []), qrCodeId]
    await updateDoc(docRef, {
      redeemedPrizeCodes: updated,
      updatedAt: serverTimestamp()
    })

    console.log('✅ [redeemQRCodePrize] Premio agregado al carrito exitosamente')
    return { success: true, message: 'Premio agregado' }
  } catch (error) {
    console.error('❌ [redeemQRCodePrize] Error:', error)
    return { success: false, message: 'Error al canjear el premio' }
  }
}

/**
 * Crear notificación de escaneo de QR
 */
async function createQRScanNotification(
  businessId: string,
  userId: string,
  qrCodeId: string,
  qrCodeName: string,
  scannedCount: number,
  isCompleted: boolean
): Promise<void> {
  try {
    console.log('[createQRScanNotification] Creando notificación de escaneo de QR')

    // Obtener el nombre del cliente normalizando el teléfono
    let clientName = 'Cliente'
    try {
      const normalizedPhone = normalizeEcuadorianPhone(userId)
      const clientsRef = collection(db, 'clients')
      const q = query(clientsRef, where('celular', '==', normalizedPhone), limit(1))
      const clientSnapshot = await getDocs(q)

      if (!clientSnapshot.empty) {
        const clientData = clientSnapshot.docs[0].data()
        clientName = clientData.nombres || 'Cliente'
      }
    } catch (error) {
      console.debug('[createQRScanNotification] Error obteniendo nombre del cliente:', error)
      // Continuar con nombre genérico si hay error
    }

    const notificationData = {
      type: 'qr_scan' as const,
      userId,
      qrCodeId,
      qrCodeName,
      clientName,
      scannedCount,
      isCompleted,
      title: isCompleted
        ? `¡${clientName} completó la colección!`
        : `${clientName} escaneó un código`,
      message: isCompleted
        ? `Ha completado todos los 5 códigos de la colección`
        : `Escaneó "${qrCodeName}" (${scannedCount}/5 códigos)`,
      read: false,
      createdAt: serverTimestamp()
    }

    // Guardar directamente en Firestore usando el SDK cliente
    const notificationsRef = collection(db, 'businesses', businessId, 'notifications')
    const docRef = await addDoc(notificationsRef, notificationData)

    console.log('[createQRScanNotification] Notificación guardada con ID:', docRef.id)
  } catch (error) {
    console.error('[createQRScanNotification] Error saving QR scan notification:', error)
    // No fallar el escaneo si hay error en notificación
  }
}

/**
 * Escanear un código QR
 */
export async function scanQRCode(userId: string, qrCodeId: string): Promise<{
  success: boolean
  message: string
  progress?: UserQRProgress
}> {
  try {
    // Verificar que el código QR existe y está activo
    const qrCode = await getQRCodeById(qrCodeId)

    if (!qrCode) {
      return {
        success: false,
        message: 'Código QR no válido'
      }
    }

    if (!qrCode.isActive) {
      return {
        success: false,
        message: 'Este código QR ya no está activo'
      }
    }

    // Obtener o crear progreso del usuario
    let progress = await getUserQRProgress(userId, qrCode.businessId)

    if (!progress) {
      // Crear nuevo progreso
      const progressData = {
        userId,
        businessId: qrCode.businessId,
        scannedCodes: [qrCodeId],
        completed: false,
        lastScanned: serverTimestamp(),
        rewardClaimed: false,
        createdAt: serverTimestamp()
      }

      await addDoc(collection(db, 'userQRProgress'), progressData)

      progress = {
        userId,
        businessId: qrCode.businessId,
        scannedCodes: [qrCodeId],
        completed: false,
        lastScanned: new Date(),
        rewardClaimed: false,
        createdAt: new Date()
      }

      // Crear notificación de escaneo
      await createQRScanNotification(
        qrCode.businessId,
        userId,
        qrCodeId,
        qrCode.name,
        1,
        false
      )

      return {
        success: true,
        message: `¡Código escaneado! (1/5)`,
        progress
      }
    }

    // Verificar si ya escaneó este código
    if (progress.scannedCodes.includes(qrCodeId)) {
      return {
        success: false,
        message: 'Ya escaneaste este código anteriormente'
      }
    }

    // Agregar código a la lista de escaneados
    const updatedScannedCodes = [...progress.scannedCodes, qrCodeId]
    const isCompleted = updatedScannedCodes.length >= 5

    // Actualizar progreso
    const q = query(
      collection(db, 'userQRProgress'),
      where('userId', '==', userId),
      where('businessId', '==', qrCode.businessId),
      limit(1)
    )
    const snapshot = await getDocs(q)

    if (!snapshot.empty) {
      const docRef = snapshot.docs[0].ref
      await updateDoc(docRef, {
        scannedCodes: updatedScannedCodes,
        completed: isCompleted,
        lastScanned: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    }

    const updatedProgress: UserQRProgress = {
      ...progress,
      scannedCodes: updatedScannedCodes,
      completed: isCompleted,
      lastScanned: new Date(),
      updatedAt: new Date()
    }

    // Crear notificación de escaneo
    await createQRScanNotification(
      qrCode.businessId,
      userId,
      qrCodeId,
      qrCode.name,
      updatedScannedCodes.length,
      isCompleted
    )

    return {
      success: true,
      message: isCompleted
        ? '¡Felicidades! Completaste la colección'
        : `¡Código escaneado! (${updatedScannedCodes.length}/5)`,
      progress: updatedProgress
    }
  } catch (error) {
    console.error('Error scanning QR code:', error)
    return {
      success: false,
      message: 'Error al procesar el código QR'
    }
  }
}

/**
 * Reclamar recompensa
 */
export async function claimReward(userId: string, businessId: string): Promise<{
  success: boolean
  message: string
}> {
  try {
    const progress = await getUserQRProgress(userId, businessId)

    if (!progress) {
      return {
        success: false,
        message: 'No tienes progreso registrado'
      }
    }

    if (!progress.completed) {
      return {
        success: false,
        message: 'Aún no has completado la colección'
      }
    }

    if (progress.rewardClaimed) {
      return {
        success: false,
        message: 'Ya reclamaste tu recompensa'
      }
    }

    // Actualizar estado de recompensa
    const q = query(
      collection(db, 'userQRProgress'),
      where('userId', '==', userId),
      where('businessId', '==', businessId),
      limit(1)
    )
    const snapshot = await getDocs(q)

    if (!snapshot.empty) {
      const docRef = snapshot.docs[0].ref
      await updateDoc(docRef, {
        rewardClaimed: true,
        updatedAt: serverTimestamp()
      })
    }

    return {
      success: true,
      message: '¡Recompensa reclamada exitosamente!'
    }
  } catch (error) {
    console.error('Error claiming reward:', error)
    return {
      success: false,
      message: 'Error al reclamar la recompensa'
    }
  }
}

/**
 * Crear notificación de calificación/reseña
 */
export async function createRatingNotification(
  businessId: string,
  orderId: string,
  rating: number,
  review: string,
  clientName: string,
  clientPhone?: string
): Promise<void> {
  try {
    console.log('[createRatingNotification] Creando notificación de calificación')

    const notificationData = {
      type: 'rating' as const,
      orderId,
      rating,
      review,
      clientName,
      clientPhone: clientPhone || '',
      title: `Nueva calificación: ⭐ ${rating}/5`,
      message: `${clientName} ha dejado una calificación de ${rating}/5${review ? ` con comentario: "${review}"` : ''}`,
      read: false,
      createdAt: serverTimestamp()
    }

    // Guardar directamente en Firestore usando el SDK cliente
    const notificationsRef = collection(db, 'businesses', businessId, 'notifications')
    const docRef = await addDoc(notificationsRef, notificationData)

    console.log('[createRatingNotification] Notificación guardada con ID:', docRef.id)
  } catch (error) {
    console.error('[createRatingNotification] Error saving rating notification:', error)
    // No fallar si la notificación no se guarda
  }
}

/**
 * Obtener estadísticas de escaneos por código QR
 * Retorna la cantidad de escaneos para cada código
 */
export async function getQRScanStatistics(businessId: string): Promise<{
  [qrCodeId: string]: number
}> {
  try {
    const userProgressQuery = query(
      collection(db, 'userQRProgress'),
      where('businessId', '==', businessId)
    )

    const snapshot = await getDocs(userProgressQuery)
    const scanStats: { [qrCodeId: string]: number } = {}

    // Contar cuántas veces se escaneó cada código
    snapshot.forEach((doc) => {
      const progress = doc.data() as UserQRProgress
      if (progress.scannedCodes && Array.isArray(progress.scannedCodes)) {
        progress.scannedCodes.forEach((codeId) => {
          scanStats[codeId] = (scanStats[codeId] || 0) + 1
        })
      }
    })

    return scanStats
  } catch (error) {
    console.error('[getQRScanStatistics] Error getting scan statistics:', error)
    return {}
  }
}

/**
 * Obtener usuarios con más escaneos
 * Retorna una lista ordenada de usuarios que más códigos han escaneado
 * Incluye el nombre del cliente obtenido de la colección 'clients'
 */
export async function getTopQRScanners(
  businessId: string,
  topLimit: number = 10
): Promise<
  Array<{
    userId: string
    userName?: string
    scannedCount: number
    scannedCodes: string[]
    completed: boolean
    lastScanned?: Date | Timestamp
  }>
> {
  try {
    const userProgressQuery = query(
      collection(db, 'userQRProgress'),
      where('businessId', '==', businessId)
    )

    const snapshot = await getDocs(userProgressQuery)
    const topScanners = snapshot.docs
      .map((doc) => {
        const progress = doc.data() as UserQRProgress
        return {
          userId: progress.userId,
          scannedCount: progress.scannedCodes?.length || 0,
          scannedCodes: progress.scannedCodes || [],
          completed: progress.completed,
          lastScanned: progress.lastScanned
        }
      })
      .sort((a, b) => b.scannedCount - a.scannedCount)
      .slice(0, topLimit)

    // Obtener nombres de los clientes
    const scannersWithNames = await Promise.all(
      topScanners.map(async (scanner) => {
        try {
          // Normalizar el celular para buscar (puede venir en diferentes formatos)
          const normalizedPhone = normalizeEcuadorianPhone(scanner.userId)

          // Buscar el cliente por celular (userId es el celular)
          const clientQuery = query(
            collection(db, 'clients'),
            where('celular', '==', normalizedPhone),
            limit(1)
          )
          const clientSnapshot = await getDocs(clientQuery)

          let userName: string | undefined

          if (!clientSnapshot.empty) {
            const clientData = clientSnapshot.docs[0].data()
            userName = clientData.nombres || undefined
          }

          return {
            ...scanner,
            userName
          }
        } catch (error) {
          console.error(`Error getting client name for ${scanner.userId}:`, error)
          return scanner
        }
      })
    )

    return scannersWithNames
  } catch (error) {
    console.error('[getTopQRScanners] Error getting top scanners:', error)
    return []
  }
}

/**
 * Obtener información detallada de estadísticas
 * Incluye total de usuarios, promedio de escaneos, etc.
 */
export async function getQRStatisticsDetail(businessId: string): Promise<{
  totalUsers: number
  totalScans: number
  averageScansPerUser: number
  usersCompleted: number
  completionRate: number
}> {
  try {
    const userProgressQuery = query(
      collection(db, 'userQRProgress'),
      where('businessId', '==', businessId)
    )

    const snapshot = await getDocs(userProgressQuery)
    let totalScans = 0
    let usersCompleted = 0

    snapshot.forEach((doc) => {
      const progress = doc.data() as UserQRProgress
      totalScans += progress.scannedCodes?.length || 0
      if (progress.completed) {
        usersCompleted++
      }
    })

    const totalUsers = snapshot.size
    const averageScansPerUser = totalUsers > 0 ? totalScans / totalUsers : 0
    const completionRate = totalUsers > 0 ? (usersCompleted / totalUsers) * 100 : 0

    return {
      totalUsers,
      totalScans,
      averageScansPerUser,
      usersCompleted,
      completionRate
    }
  } catch (error) {
    console.error('[getQRStatisticsDetail] Error getting statistics detail:', error)
    return {
      totalUsers: 0,
      totalScans: 0,
      averageScansPerUser: 0,
      usersCompleted: 0,
      completionRate: 0
    }
  }
}

// ==================== GESTIÓN DE STOCK DE INGREDIENTES ====================

export interface IngredientStockMovement {
  id?: string
  ingredientId: string
  ingredientName: string
  type: 'entry' | 'sale' | 'adjustment'  // entry = entrada de stock, sale = venta/uso, adjustment = ajuste manual
  quantity: number
  date: string  // YYYY-MM-DD
  notes?: string
  createdAt?: any
  businessId: string
  orderId?: string // Vincula el movimiento con una venta específica
  unitCost?: number // Costo unitario al momento de la entrada
}

export interface IngredientStockSummary {
  ingredientId: string
  libraryId?: string
  ingredientName: string
  currentStock: number
  unit: string
  unitCost?: number
  movements: IngredientStockMovement[]
}

/**
 * Registrar un movimiento de stock (entrada, venta o ajuste)
 */
export async function recordStockMovement(
  movement: Omit<IngredientStockMovement, 'id' | 'createdAt'>
): Promise<string> {
  try {
    const movementData = cleanObject({
      ...movement,
      createdAt: serverTimestamp()
    })
    const docRef = await addDoc(
      collection(db, 'ingredientStockMovements'),
      movementData
    )

    // Registrar en la biblioteca de ingredientes para mantener consistencia
    await addOrUpdateIngredientInLibrary(
      movement.businessId,
      movement.ingredientName,
      movement.type === 'entry' ? movement.unitCost || 0 : 0
    )

    return docRef.id
  } catch (error) {
    console.error('Error recording stock movement:', error)
    throw error
  }
}

/**
 * Obtener movimientos de stock de un ingrediente en un rango de fechas
 */
export async function getStockMovements(
  businessId: string,
  ingredientId?: string,
  startDate?: Date,
  endDate?: Date
): Promise<IngredientStockMovement[]> {
  try {
    const movementsRef = collection(db, 'ingredientStockMovements')

    let constraints: any[] = [where('businessId', '==', businessId)]

    if (ingredientId) {
      constraints.push(where('ingredientId', '==', ingredientId))
    }

    // Filtrar por rango de fechas si se proporciona
    if (startDate && endDate) {
      const startStr = startDate.toISOString().split('T')[0]
      const endStr = endDate.toISOString().split('T')[0]
      constraints.push(where('date', '>=', startStr))
      constraints.push(where('date', '<=', endStr))
    }

    constraints.push(orderBy('date', 'desc'))
    constraints.push(orderBy('createdAt', 'desc'))

    const q = query(movementsRef, ...constraints)
    const snapshot = await getDocs(q)

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as IngredientStockMovement[]
  } catch (error) {
    console.error('Error getting stock movements:', error)
    throw error
  }
}

/**
 * Calcular stock disponible de un ingrediente en una fecha específica
 */
export async function calculateCurrentStock(
  businessId: string,
  ingredientId: string,
  asOfDate?: string
): Promise<number> {
  try {
    const movementsRef = collection(db, 'ingredientStockMovements')
    const dateFilter = asOfDate || new Date().toISOString().split('T')[0]

    let constraints: any[] = [
      where('businessId', '==', businessId),
      where('ingredientId', '==', ingredientId),
      where('date', '<=', dateFilter)
    ]

    const q = query(movementsRef, ...constraints)
    const snapshot = await getDocs(q)

    // Sort in memory instead of using composite orderBy
    const movements = snapshot.docs.map(doc => doc.data() as IngredientStockMovement)
    movements.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date)
      if (dateCompare !== 0) return dateCompare
      return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
    })

    let stock = 0
    movements.forEach(movement => {
      if (movement.type === 'entry' || movement.type === 'adjustment') {
        stock += movement.quantity
      } else if (movement.type === 'sale') {
        stock -= movement.quantity
      }
    })

    return stock
  } catch (error) {
    console.error('Error calculating current stock:', error)
    throw error
  }
}

/**
 * Obtener resumen de stock de todos los ingredientes
 */
export async function getIngredientStockSummary(
  businessId: string
): Promise<IngredientStockSummary[]> {
  try {
    // Obtener la biblioteca primero para tener la lista base de ingredientes
    const library = await getIngredientLibrary(businessId)
    const movementsRef = collection(db, 'ingredientStockMovements')
    const q = query(movementsRef, where('businessId', '==', businessId))
    const snapshot = await getDocs(q)

    const ingredientMap = new Map<string, IngredientStockSummary>()
    const currentDate = new Date().toISOString().split('T')[0]

    // Helper para normalizar
    const normalize = (name: string) => name.trim().toLowerCase();
    const generateId = (name: string) => `ing_${normalize(name).replace(/\s+/g, '_')}`;

    // Inicializar el mapa con los ingredientes de la biblioteca
    library.forEach(item => {
      const normName = normalize(item.name)
      ingredientMap.set(normName, {
        ingredientId: generateId(item.name),
        libraryId: item.id,
        ingredientName: item.name.trim(),
        currentStock: 0,
        unit: 'unidad',
        unitCost: item.unitCost,
        movements: []
      })
    })

    // Procesar todos los movimientos para actualizar el stock de los ingredientes
    snapshot.docs.forEach(doc => {
      const m = doc.data() as IngredientStockMovement
      const normName = normalize(m.ingredientName)
      const ingId = m.ingredientId || generateId(m.ingredientName)

      if (!ingredientMap.has(normName)) {
        ingredientMap.set(normName, {
          ingredientId: ingId,
          ingredientName: m.ingredientName.trim(),
          currentStock: 0,
          unit: 'unidad', // Valor por defecto
          movements: []
        })
      }

      const summary = ingredientMap.get(normName)!

      // Solo sumamos movimientos hasta la fecha actual
      if (m.date <= currentDate) {
        if (m.type === 'entry' || m.type === 'adjustment') {
          summary.currentStock += m.quantity
        } else if (m.type === 'sale') {
          summary.currentStock -= m.quantity
        }
      }
    })

    // Devolver lista ordenada alfabéticamente
    return Array.from(ingredientMap.values()).sort((a, b) =>
      a.ingredientName.localeCompare(b.ingredientName)
    )
  } catch (error) {
    console.error('[getIngredientStockSummary] Error:', error)
    return []
  }
}

/**
 * Calcular consumo de un ingrediente desde órdenes en un rango de fechas
 * (Similar a como se hace en calculateCostReport)
 */
export async function calculateIngredientConsumption(
  businessId: string,
  ingredientName: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  try {
    const ordersRef = collection(db, 'orders')
    const q = query(
      ordersRef,
      where('businessId', '==', businessId),
      where('status', '!=', 'cancelled')
    )

    const ordersSnapshot = await getDocs(q)
    const productsSnapshot = await getDocs(
      query(collection(db, 'products'), where('businessId', '==', businessId))
    )

    const productsMap = new Map<string, any>()
    productsSnapshot.forEach(doc => {
      productsMap.set(doc.id, { id: doc.id, ...doc.data() })
    })

    let totalConsumption = 0

    const toDateSafe = (d: any) => {
      if (!d) return new Date(0)
      if (d instanceof Date) return d
      if (typeof d === 'object' && typeof d.toDate === 'function') return d.toDate()
      if (typeof d === 'object' && 'seconds' in d && typeof d.seconds === 'number') {
        return new Date(d.seconds * 1000)
      }
      return new Date(d)
    }

    ordersSnapshot.forEach(orderDoc => {
      const order = orderDoc.data() as any

      let orderRefDate = toDateSafe(order.createdAt)
      try {
        if (order?.timing?.type === 'scheduled' && order?.timing?.scheduledDate) {
          orderRefDate = toDateSafe(order.timing.scheduledDate)
        }
      } catch (e) {
        // fallback
      }

      if (!(orderRefDate >= startDate && orderRefDate <= endDate)) {
        return
      }

      order.items?.forEach((item: any) => {
        const product = productsMap.get(item.productId)
        if (!product) return

        const quantity = item.quantity || 1
        const variantName = item.variant || item.name

        // Determinar qué ingredientes usar
        let ingredientsToUse: any[] = []

        if (item.variant && product.variants) {
          const variant = product.variants.find((v: any) =>
            v.name === item.variant || v.name === variantName
          )
          if (variant?.ingredients) {
            ingredientsToUse = variant.ingredients
          }
        }

        if (ingredientsToUse.length === 0 && product.ingredients) {
          ingredientsToUse = product.ingredients
        }

        // Contar consumo del ingrediente específico
        ingredientsToUse.forEach((ingredient: any) => {
          if (ingredient.name === ingredientName) {
            totalConsumption += ingredient.quantity * quantity
          }
        })
      })
    })

    return totalConsumption
  } catch (error) {
    console.error('Error calculating ingredient consumption:', error)
    return 0
  }
}

/**
 * Obtener historial de stock de un ingrediente con movimientos y stock calculado por día
 */
export async function getIngredientStockHistory(
  businessId: string,
  ingredientId: string,
  startDate: Date,
  endDate: Date
): Promise<Array<{
  date: string
  movements: IngredientStockMovement[]
  stockAtEndOfDay: number
}>> {
  try {
    const movements = await getStockMovements(businessId, ingredientId, startDate, endDate)

    const historyMap = new Map<string, {
      date: string
      movements: IngredientStockMovement[]
      stockAtEndOfDay: number
    }>()

    // Agrupar por fecha
    movements.forEach(movement => {
      if (!historyMap.has(movement.date)) {
        historyMap.set(movement.date, {
          date: movement.date,
          movements: [],
          stockAtEndOfDay: 0
        })
      }
      historyMap.get(movement.date)!.movements.push(movement)
    })

    // Calcular stock al final de cada día
    const sortedDates = Array.from(historyMap.keys()).sort()
    for (const date of sortedDates) {
      const stock = await calculateCurrentStock(businessId, ingredientId, date)
      historyMap.get(date)!.stockAtEndOfDay = stock
    }

    return Array.from(historyMap.values()).sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    )
  } catch (error) {
    console.error('Error getting ingredient stock history:', error)
    return []
  }
}

/**
 * Registrar automáticamente el consumo de ingredientes cuando se crea una orden
 * Extrae ingredientes de los productos y registra movimientos de "sale"
 */
export async function registerOrderConsumption(
  businessId: string,
  items: Array<{
    productId: string
    variant?: string
    name: string
    quantity: number
  }>,
  orderDate?: string,
  orderId?: string
): Promise<void> {
  try {
    const dateForMovement = orderDate || new Date().toISOString().split('T')[0]

    // 1. Obtener los productos involucrados para conocer sus ingredientes
    const productsSnapshot = await getDocs(
      query(collection(db, 'products'), where('businessId', '==', businessId))
    )

    const productsMap = new Map<string, any>()
    productsSnapshot.forEach(doc => {
      productsMap.set(doc.id, { id: doc.id, ...doc.data() })
    })

    // 2. Procesar cada item vendido
    for (const item of items) {
      const product = productsMap.get(item.productId)
      if (!product) continue

      // Determinar ingredientes (Prioridad: Variante > Producto Base)
      let ingredientsToUse: any[] = []
      if (item.variant && product.variants) {
        const variant = product.variants.find((v: any) => v.name === item.variant)
        if (variant?.ingredients) ingredientsToUse = variant.ingredients
      }

      if (ingredientsToUse.length === 0 && product.ingredients) {
        ingredientsToUse = product.ingredients
      }

      // 3. Registrar salida de stock para cada ingrediente (Punto 4 del pedido)
      for (const ingredient of ingredientsToUse) {
        try {
          // Generar un ID único normalizado: ing_nombre_del_ingrediente
          const normalizedName = ingredient.name.trim().toLowerCase();
          const ingredientId = `ing_${normalizedName.replace(/\s+/g, '_')}`;

          await recordStockMovement({
            ingredientId: ingredientId,
            ingredientName: ingredient.name.trim(),
            type: 'sale',
            quantity: ingredient.quantity * item.quantity, // Cantidad por ingrediente * cantidad de productos
            date: dateForMovement,
            notes: `Venta automática - Orden: ${orderId || 'Manual'}`,
            businessId: businessId,
            orderId: orderId
          })
        } catch (error) {
          console.error(`Error procesando ingrediente ${ingredient.name}:`, error)
        }
      }
    }
  } catch (error) {
    console.error('Error global en registro de consumo:', error)
  }
}
