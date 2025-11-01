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
  Timestamp
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage, googleProvider, auth } from './firebase'
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
    const docRef = doc(db, 'products', productId)
    await deleteDoc(docRef)
  } catch (error) {
    console.error('Error deleting product:', error)
    throw error
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
    console.log('🗑️ Deleting order:', orderId);
    const docRef = doc(db, 'orders', orderId)
    await deleteDoc(docRef)
    console.log('✅ Order deleted successfully');
  } catch (error) {
    console.error('❌ Error deleting order:', error);
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
}

export interface ClientLocation {
  id: string;
  id_cliente: string;
  referencia: string;
  sector: string;
  tarifa: string;
  latlong: string;
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
        name: businessData.name || '',
        username: businessData.username || '',
        description: businessData.description || '',
        address: businessData.address || '',
        phone: businessData.phone || '',
        email: businessData.email || '',
        ownerId: businessData.ownerId || '',
        image: businessData.image || '',
        coverImage: businessData.coverImage || '',
        categories: businessData.categories || [],
        mapLocation: businessData.mapLocation || { lat: 0, lng: 0 },
        references: businessData.references || '',
        bankAccount: businessData.bankAccount || undefined,
        schedule: businessData.schedule || {},
        isActive: businessData.isActive || false,
        createdAt: toSafeDate(businessData.createdAt),
        updatedAt: toSafeDate(businessData.updatedAt)
      };
      
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
        latlong: locationData.latlong || ''
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

export async function updateClient(clientId: string, clientData: { celular?: string; nombres?: string; email?: string }) {
  try {
    console.log('📝 Updating client:', clientId, clientData);

    const clientRef = doc(db, 'clients', clientId);
    const updateData: any = {};
    
    if (clientData.celular) updateData.celular = clientData.celular;
    if (clientData.nombres) updateData.nombres = clientData.nombres;
    if (clientData.email !== undefined) updateData.email = clientData.email;
    
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
export async function createClientLocation(locationData: { id_cliente: string, latlong: string, referencia: string, tarifa: string, sector: string }): Promise<string> {
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
        name: businessData.name || '',
        username: businessData.username || '',
        description: businessData.description || '',
        address: businessData.address || '',
        phone: businessData.phone || '',
        email: businessData.email || '',
        ownerId: businessData.ownerId || '',
        image: businessData.image || '',
        coverImage: businessData.coverImage || '',
        categories: businessData.categories || [],
        mapLocation: businessData.mapLocation || { lat: 0, lng: 0 },
        references: businessData.references || '',
        bankAccount: businessData.bankAccount || undefined,
        schedule: businessData.schedule || {},
        isActive: businessData.isActive !== false,
        createdAt: toSafeDate(businessData.createdAt),
        updatedAt: toSafeDate(businessData.updatedAt)
      });
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
          name: businessData.name || '',
          username: businessData.username || '',
          email: businessData.email || '',
          phone: businessData.phone || '',
          address: businessData.address || '',
          description: businessData.description || '',
          image: businessData.image || '',
          coverImage: businessData.coverImage || '',
          categories: businessData.categories || [],
          mapLocation: businessData.mapLocation || { lat: 0, lng: 0 },
          references: businessData.references || '',
          bankAccount: businessData.bankAccount || undefined,
          schedule: businessData.schedule || {},
          isActive: businessData.isActive !== false,
          createdAt: toSafeDate(businessData.createdAt),
          updatedAt: toSafeDate(businessData.updatedAt),
          ownerId: businessData.ownerId || '',
          administrators: administrators
        });
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

// ==================== QR CODE FUNCTIONS ====================

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
export async function getQRCodesByBusiness(businessId: string): Promise<QRCode[]> {
  try {
    const q = query(
      collection(db, 'qrCodes'),
      where('businessId', '==', businessId),
      where('isActive', '==', true)
    )
    const snapshot = await getDocs(q)
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate() || new Date(),
      updatedAt: doc.data().updatedAt?.toDate()
    } as QRCode))
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
    const q = query(
      collection(db, 'userQRProgress'),
      where('userId', '==', userId),
      where('businessId', '==', businessId),
      limit(1)
    )
    const snapshot = await getDocs(q)
    
    if (snapshot.empty) {
      return null
    }
    
    const doc = snapshot.docs[0]
    return {
      userId: doc.data().userId,
      scannedCodes: doc.data().scannedCodes || [],
      completed: doc.data().completed || false,
      lastScanned: doc.data().lastScanned?.toDate(),
      rewardClaimed: doc.data().rewardClaimed || false,
      businessId: doc.data().businessId,
      createdAt: doc.data().createdAt?.toDate() || new Date(),
      updatedAt: doc.data().updatedAt?.toDate()
    } as UserQRProgress
  } catch (error) {
    console.error('Error getting user QR progress:', error)
    throw error
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
