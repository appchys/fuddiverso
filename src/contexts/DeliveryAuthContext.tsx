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
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {


      if (firebaseUser && savedDeliveryId) {
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL
        })
        setAuthLoading(false)

      } else if (!firebaseUser) {
        // Si el usuario no está autenticado en Firebase, limpiar todo
        setUser(null)
        setDeliveryIdState(null)
        localStorage.removeItem('deliveryId')
        setAuthLoading(false)

      } else {
        // Tenemos firebaseUser pero faltan datos en localStorage
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL
        })
        setAuthLoading(false)
        console.warn('[DeliveryAuth] Firebase user present but missing localStorage delivery')
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
