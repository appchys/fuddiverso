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
  CoverageZone 
} from '../types'

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
    
    const docRef = await addDoc(collection(db, 'orders'), {
      ...cleanOrderData,
      createdAt: serverTimestamp()
    })
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
      where('businessId', '==', businessId)
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
    await updateDoc(docRef, { 
      status,
      updatedAt: serverTimestamp()
    })
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
    const docRef = doc(db, 'orders', orderId)
    await deleteDoc(docRef)
  } catch (error) {
    console.error('Error deleting order:', error)
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
    console.error('Error getting client locations:', error);
    throw error;
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
        fecha_de_registro: clientData.fecha_de_registro || new Date().toISOString()
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

export async function createClient(clientData: { celular: string; nombres: string; fecha_de_registro?: string; id?: string }) {
  try {
    console.log('📝 Creating client:', clientData);

    const clientRef = await addDoc(collection(db, 'clients'), {
      celular: clientData.celular,
      nombres: clientData.nombres,
      fecha_de_registro: clientData.fecha_de_registro || new Date().toLocaleDateString(),
      id: clientData.id || ''
    });

    console.log('✅ Client created with ID:', clientRef.id);
    return {
      id: clientRef.id,
      ...clientData
    };
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

export interface Delivery {
  id?: string
  nombres: string
  celular: string
  email: string
  fotoUrl?: string
  estado: 'activo' | 'inactivo'
  fechaRegistro: string
}

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
        fechaRegistro: data.fechaRegistro || new Date().toISOString()
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
        fechaRegistro: data.fechaRegistro || new Date().toISOString()
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
        fechaRegistro: data.fechaRegistro || new Date().toISOString()
      })
    })
    
    return deliveries
  } catch (error) {
    console.error('Error getting deliveries by status:', error)
    return []
  }
}
