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
import { db, storage, googleProvider, auth } from './firebase'
import { 
  signInWithRedirect, 
  getRedirectResult, 
  UserCredential,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth'
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
        createdAt: doc.data().createdAt?.toDate() || new Date()
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
      
      // Verificar si el usuario ya tiene un negocio registrado
      console.log('🔍 Checking for existing business...');
      const existingBusiness = await getBusinessByOwner(result.user.uid);
      console.log('🏢 Business check result:', existingBusiness ? 'Found' : 'Not found');
      
      return {
        user: result.user,
        hasBusinessProfile: !!existingBusiness,
        businessId: existingBusiness?.id
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
  fecha_de_registro?: string;
}

export interface ClientLocation {
  id: string;
  id_cliente: string;
  referencia: string;
  sector: string;
  tarifa: string;
  ubicacion: string;
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

    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      const businessData = doc.data();
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
        categories: businessData.categories || [],
        mapLocation: businessData.mapLocation || { lat: 0, lng: 0 },
        references: businessData.references || '',
        bankAccount: businessData.bankAccount || undefined,
        schedule: businessData.schedule || {},
        isActive: businessData.isActive || false,
        createdAt: businessData.createdAt?.toDate() || new Date(),
        updatedAt: businessData.updatedAt?.toDate() || new Date()
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
        ubicacion: locationData.ubicacion || ''
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
