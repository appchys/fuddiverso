import { getRedirectResult } from 'firebase/auth';
// Manejar el resultado del redirect de Google
export async function handleGoogleRedirectResult() {
  try {
    const result = await getRedirectResult(auth);
    console.log('[GOOGLE REDIRECT] Resultado de getRedirectResult:', result);
    if (result?.user) {
      console.log('[GOOGLE REDIRECT] UID del usuario autenticado:', result.user.uid);
      const existingBusiness = await getBusinessByOwner(result.user.uid);
      console.log('[GOOGLE REDIRECT] Resultado de getBusinessByOwner:', existingBusiness);
      return {
        user: result.user,
        hasBusinessProfile: !!existingBusiness,
        businessId: existingBusiness?.id
      };
    }
    console.log('[GOOGLE REDIRECT] No hay usuario en el resultado del redirect.');
    return null;
  } catch (error: any) {
    if (error.code === 'auth/no-auth-event') {
      console.log('[GOOGLE REDIRECT] No auth event (no venía de redirect)');
      return null;
    }
    console.error('[GOOGLE REDIRECT] Error inesperado:', error);
    throw error;
  }
}
import { 
  collection, 
  doc, 
  addDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  limit,
  orderBy, 
  serverTimestamp,
  Timestamp
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage, googleProvider } from './firebase'
import { signInWithRedirect } from 'firebase/auth';
import { auth } from './firebase'
import { signInWithPopup } from 'firebase/auth'
import { Business, Product, Order } from '../types'

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
    email: formData.email,
    phone: formData.phone,
    address: formData.address,
    description: formData.description,
    image: formData.image,
    ownerId: formData.ownerId,
    references: formData.references || '',
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
        createdAt: docSnap.data().createdAt?.toDate() || new Date()
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
    const q = query(
      collection(db, 'businesses'), 
      where('ownerId', '==', ownerId),
      limit(1)
    )
    const querySnapshot = await getDocs(q)
    
    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0]
      return {
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() || new Date()
      } as Business
    }
    return null
  } catch (error) {
    console.error('Error getting business by owner:', error)
    throw error
  }
}

export async function getAllBusinesses(): Promise<Business[]> {
  try {
    const querySnapshot = await getDocs(collection(db, 'businesses'))
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate() || new Date()
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
      createdAt: doc.data().createdAt?.toDate() || new Date()
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
      createdAt: doc.data().createdAt?.toDate() || new Date()
    })) as Order[]
    
    // Ordenar en JavaScript como alternativa temporal
    return orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  } catch (error) {
    console.error('Error getting orders:', error)
    throw error
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
        createdAt: docSnap.data().createdAt?.toDate() || new Date()
      } as Order
    }
    return null
  } catch (error) {
    console.error('Error getting order:', error)
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
    let q = collection(db, 'businesses')
    
    if (category && category !== 'all') {
      q = query(collection(db, 'businesses'), where('category', '==', category)) as any
    }
    
    const querySnapshot = await getDocs(q)
    let businesses = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate() || new Date()
    })) as Business[]
    
    // Filtrar por término de búsqueda en el frontend
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
export async function signInWithGoogle() {
  try {
    // Usar popup porque redirect no funciona en este entorno
    const result = await signInWithPopup(auth, googleProvider);
    console.log('[GOOGLE POPUP] Resultado:', result);
    return {
      user: result.user,
      hasBusinessProfile: false, // Puedes mejorar esto si lo necesitas
      businessId: null
    };
  } catch (error: any) {
    console.error('Error signing in with Google:', error);
    throw new Error(`Error al iniciar sesión con Google: ${error.message}`);
  }
}

export async function createBusinessFromGoogleAuth(userData: {
  name: string
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
