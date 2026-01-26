'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { onAuthStateChanged } from 'firebase/auth'

interface DeliveryUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
}

interface DeliveryAuthContextType {
  user: DeliveryUser | null
  deliveryId: string | null
  isAuthenticated: boolean
  authLoading: boolean
  login: (user: DeliveryUser, deliveryId: string) => void
  logout: () => void
}

const DeliveryAuthContext = createContext<DeliveryAuthContextType | undefined>(undefined)

export function DeliveryAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DeliveryUser | null>(null)
  const [deliveryId, setDeliveryIdState] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState<boolean>(true)

  useEffect(() => {

    // Cargar datos desde localStorage al iniciar
    const savedDeliveryId = localStorage.getItem('deliveryId')

    if (savedDeliveryId) setDeliveryIdState(savedDeliveryId)

    // Escuchar cambios en el estado de autenticación de Firebase
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {


      if (firebaseUser && savedDeliveryId) {
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL
        })
        setAuthLoading(false)

      } else if (firebaseUser && !savedDeliveryId) {
        // Intento de recuperación de sesión: Buscar delivery por UID si falta en localStorage
        try {
          // Importación dinámica para evitar problemas de SSR si fuera el caso, aunque 'use client' lo protege
          const { collection, query, where, getDocs } = await import('firebase/firestore')
          const { db } = await import('@/lib/firebase')

          const q = query(collection(db, 'deliveries'), where('uid', '==', firebaseUser.uid))
          const querySnapshot = await getDocs(q)

          if (!querySnapshot.empty) {
            const deliveryDoc = querySnapshot.docs[0]
            const restoredDeliveryId = deliveryDoc.id

            console.log('[DeliveryAuth] Sesión recuperada desde Firestore para:', firebaseUser.uid)

            // Restaurar estado y localStorage
            setDeliveryIdState(restoredDeliveryId)
            localStorage.setItem('deliveryId', restoredDeliveryId)

            setUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              photoURL: firebaseUser.photoURL
            })
          } else {
            console.warn('[DeliveryAuth] Usuario autenticado pero no se encontró perfil de delivery asociado.')
            // No deslogueamos auth.signOut() aquí para permitir debugging o manejo manual, 
            // pero el estado de contexto quedará como no autenticado (deliveryId null)
          }
        } catch (error) {
          console.error('[DeliveryAuth] Error intentando recuperar sesión:', error)
        }
        setAuthLoading(false)

      } else if (!firebaseUser) {
        // Si el usuario no está autenticado en Firebase, verificamos si hay un deliveryId guardado
        // para permitir persistencia de sesión local (ej: ingresó vía enlace mágico)
        const savedId = localStorage.getItem('deliveryId')

        if (savedId) {
          try {
            const { doc, getDoc } = await import('firebase/firestore')
            const { db } = await import('@/lib/firebase')
            const deliveryDoc = await getDoc(doc(db, 'deliveries', savedId))

            if (deliveryDoc.exists()) {
              const data = deliveryDoc.data()
              setUser({
                uid: data.uid || `magic-${savedId}`,
                email: data.email || null,
                displayName: data.nombres || 'Repartidor',
                photoURL: data.fotoUrl || null
              })
              setDeliveryIdState(savedId)
            } else {
              // Si el ID guardado ya no existe, limpiar
              setUser(null)
              setDeliveryIdState(null)
              localStorage.removeItem('deliveryId')
            }
          } catch (e) {
            console.error('[DeliveryAuth] Error recuperando datos de delivery:', e)
            setUser(null)
            setDeliveryIdState(null)
          }
        } else {
          setUser(null)
          setDeliveryIdState(null)
        }
        setAuthLoading(false)
      } else {
        // Caso residual (aunque cubierto arriba): firebaseUser presente pero falló recuperación
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL
        })
        setAuthLoading(false)
        console.warn('[DeliveryAuth] Firebase user present but missing localStorage delivery and recovery failed/skipped')
      }

    })

    return () => unsubscribe()
  }, [])

  const login = (userData: DeliveryUser, deliveryIdParam: string) => {
    setUser(userData)
    setDeliveryIdState(deliveryIdParam)

    // Persistir en localStorage
    localStorage.setItem('deliveryId', deliveryIdParam)
  }

  const logout = () => {
    setUser(null)
    setDeliveryIdState(null)

    // Limpiar localStorage
    localStorage.removeItem('deliveryId')

    // Sign out de Firebase
    auth.signOut()
  }

  return (
    <DeliveryAuthContext.Provider value={{
      user,
      deliveryId,
      isAuthenticated: !!user && !!deliveryId,
      authLoading,
      login,
      logout
    }}>
      {children}
    </DeliveryAuthContext.Provider>
  )
}

export function useDeliveryAuth() {
  const context = useContext(DeliveryAuthContext)
  if (context === undefined) {
    throw new Error('useDeliveryAuth must be used within a DeliveryAuthProvider')
  }
  return context
}
