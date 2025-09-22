'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { onAuthStateChanged } from 'firebase/auth'

interface BusinessUser {
  uid: string
  email: string | null
  displayName: string | null
}

interface BusinessAuthContextType {
  user: BusinessUser | null
  businessId: string | null
  ownerId: string | null
  isAuthenticated: boolean
  authLoading: boolean
  login: (user: BusinessUser, businessId: string, ownerId: string) => void
  logout: () => void
  setBusinessId: (businessId: string) => void
}

const BusinessAuthContext = createContext<BusinessAuthContextType | undefined>(undefined)

export function BusinessAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<BusinessUser | null>(null)
  const [businessId, setBusinessIdState] = useState<string | null>(null)
  const [ownerId, setOwnerIdState] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState<boolean>(true)

  useEffect(() => {
    console.time('[Auth] init');
    // Cargar datos desde localStorage al iniciar
    const savedBusinessId = localStorage.getItem('businessId')
    const savedOwnerId = localStorage.getItem('ownerId')
    
    if (savedBusinessId) setBusinessIdState(savedBusinessId)
    if (savedOwnerId) setOwnerIdState(savedOwnerId)

    // Escuchar cambios en el estado de autenticación de Firebase
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      console.timeEnd('[Auth] init');
      console.time('[Auth] onAuthStateChanged handler');
      if (firebaseUser && savedBusinessId && savedOwnerId) {
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName
        })
        setAuthLoading(false)
        console.debug('[Auth] Firebase user present, localStorage complete');
      } else if (!firebaseUser) {
        // Si el usuario no está autenticado en Firebase, limpiar todo
        setUser(null)
        setBusinessIdState(null)
        setOwnerIdState(null)
        localStorage.removeItem('businessId')
        localStorage.removeItem('ownerId')
        localStorage.removeItem('currentBusinessId')
        setAuthLoading(false)
        console.debug('[Auth] No Firebase user, cleared localStorage');
      } else {
        // Tenemos firebaseUser pero faltan datos en localStorage
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName
        })
        setAuthLoading(false)
        console.warn('[Auth] Firebase user present but missing localStorage business/owner');
      }
      console.timeEnd('[Auth] onAuthStateChanged handler');
    })

    return () => unsubscribe()
  }, [])

  const login = (userData: BusinessUser, businessIdParam: string, ownerIdParam: string) => {
    setUser(userData)
    setBusinessIdState(businessIdParam)
    setOwnerIdState(ownerIdParam)
    
    // Persistir en localStorage
    localStorage.setItem('businessId', businessIdParam)
    localStorage.setItem('ownerId', ownerIdParam)
    localStorage.setItem('currentBusinessId', businessIdParam)
  }

  const logout = () => {
    setUser(null)
    setBusinessIdState(null)
    setOwnerIdState(null)
    
    // Limpiar localStorage
    localStorage.removeItem('businessId')
    localStorage.removeItem('ownerId')
    localStorage.removeItem('currentBusinessId')
    
    // Sign out de Firebase
    auth.signOut()
  }

  const setBusinessId = (newBusinessId: string) => {
    setBusinessIdState(newBusinessId)
    localStorage.setItem('businessId', newBusinessId)
    localStorage.setItem('currentBusinessId', newBusinessId)
  }

  return (
    <BusinessAuthContext.Provider value={{
      user,
      businessId,
      ownerId,
      isAuthenticated: !!user && !!businessId && !!ownerId,
      authLoading,
      login,
      logout,
      setBusinessId
    }}>
      {children}
    </BusinessAuthContext.Provider>
  )
}

export function useBusinessAuth() {
  const context = useContext(BusinessAuthContext)
  if (context === undefined) {
    throw new Error('useBusinessAuth must be used within a BusinessAuthProvider')
  }
  return context
}
