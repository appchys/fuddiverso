import { collection, query, where, getDocs, limit } from 'firebase/firestore'
import { db } from './firebase'
import { normalizeEcuadorianPhone } from './validation'

export interface ClientSearchResult {
  id: string
  celular: string
  nombres: string
  fecha_de_registro?: string
  [key: string]: any
}

/**
 * Buscar clientes por teléfono o nombre
 * @param searchTerm - Teléfono o nombre del cliente
 * @param searchType - 'phone', 'name', o 'auto' (intenta detectar automáticamente)
 * @returns Array de clientes que coincidan con la búsqueda
 */
export async function searchClients(
  searchTerm: string,
  searchType: 'phone' | 'name' | 'auto' = 'auto'
): Promise<ClientSearchResult[]> {
  if (!searchTerm || !searchTerm.trim()) {
    return []
  }

  const trimmedSearch = searchTerm.trim()

  // Detectar automáticamente si es teléfono o nombre
  let type = searchType
  if (type === 'auto') {
    // Si contiene solo dígitos y tiene longitud >= 7, probablemente es un teléfono
    type = /^\d{7,}$/.test(trimmedSearch.replace(/[\s\-\(\)]/g, '')) ? 'phone' : 'name'
  }

  try {
    if (type === 'phone') {
      return await searchClientsByPhone(trimmedSearch)
    } else {
      return await searchClientsByName(trimmedSearch)
    }
  } catch (error) {
    console.error('Error searching clients:', error)
    return []
  }
}

/**
 * Buscar cliente por teléfono exacto
 * @param phone - Número de teléfono
 * @returns Array con el cliente encontrado o vacío
 */
async function searchClientsByPhone(phone: string): Promise<ClientSearchResult[]> {
  try {
    const normalizedPhone = normalizeEcuadorianPhone(phone)

    if (normalizedPhone.length < 10) {
      return []
    }

    const clientsRef = collection(db, 'clients')
    const q = query(clientsRef, where('celular', '==', normalizedPhone), limit(1))

    const snapshot = await getDocs(q)
    const clients: ClientSearchResult[] = []

    snapshot.forEach((doc) => {
      clients.push({
        id: doc.id,
        ...doc.data()
      } as ClientSearchResult)
    })

    return clients
  } catch (error) {
    console.error('Error searching client by phone:', error)
    return []
  }
}

/**
 * Buscar clientes por nombre (búsqueda parcial)
 * @param name - Nombre o parte del nombre
 * @returns Array de clientes que coincidan
 */
async function searchClientsByName(name: string): Promise<ClientSearchResult[]> {
  try {
    const searchTerm = name.toLowerCase().trim()

    if (searchTerm.length < 2) {
      return []
    }

    const clientsRef = collection(db, 'clients')
    const snapshot = await getDocs(clientsRef)

    const matchingClients: ClientSearchResult[] = []

    snapshot.forEach((doc) => {
      const clientName = (doc.data().nombres || '').toLowerCase()

      // Búsqueda flexible: si el nombre empieza con el término de búsqueda
      // o si alguna palabra del nombre coincide
      if (clientName.includes(searchTerm)) {
        matchingClients.push({
          id: doc.id,
          ...doc.data()
        } as ClientSearchResult)
      }
    })

    // Ordenar resultados: primero los que comienzan con el término de búsqueda
    matchingClients.sort((a, b) => {
      const aStarts = (a.nombres || '').toLowerCase().startsWith(searchTerm)
      const bStarts = (b.nombres || '').toLowerCase().startsWith(searchTerm)

      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1

      // Si ambos empiezan igual, ordenar alfabéticamente
      return (a.nombres || '').localeCompare(b.nombres || '')
    })

    // Limitar a 10 resultados máximo
    return matchingClients.slice(0, 10)
  } catch (error) {
    console.error('Error searching clients by name:', error)
    return []
  }
}

/**
 * Obtener un cliente por su ID
 * @param clientId - ID del cliente
 * @returns Cliente o null si no existe
 */
export async function getClientById(clientId: string): Promise<ClientSearchResult | null> {
  try {
    const clientsRef = collection(db, 'clients')
    const q = query(clientsRef, where('id', '==', clientId), limit(1))

    const snapshot = await getDocs(q)

    if (snapshot.empty) {
      return null
    }

    const doc = snapshot.docs[0]
    return {
      id: doc.id,
      ...doc.data()
    } as ClientSearchResult
  } catch (error) {
    console.error('Error getting client by ID:', error)
    return null
  }
}
