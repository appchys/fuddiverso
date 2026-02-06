'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { onAuthStateChanged } from 'firebase/auth'

interface BusinessUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL?: string | null
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

export { BusinessAuthContext }

export function BusinessAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<BusinessUser | null>(null)
  const [businessId, setBusinessIdState] = useState<string | null>(null)
  const [ownerId, setOwnerIdState] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState<boolean>(true)

  useEffect(() => {
    // Cargar datos desde localStorage al iniciar
    const savedBusinessId = localStorage.getItem('businessId')
    const savedOwnerId = localStorage.getItem('ownerId')

    if (savedBusinessId) setBusinessIdState(savedBusinessId)
    if (savedOwnerId) setOwnerIdState(savedOwnerId)

    // Escuchar cambios en el estado de autenticación de Firebase
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Tenemos usuario en Firebase
        let currentBusinessId = savedBusinessId
        let currentOwnerId = savedOwnerId

        // Verificar si hay autenticación pendiente (por timeout)
        const pendingAuthStr = localStorage.getItem('pendingAuth');

        // Si faltan datos en localStorage, intentamos recuperarlos
        if (!currentBusinessId || !currentOwnerId) {
          // Primero intentar recuperar de pending auth si existe y es reciente
          if (pendingAuthStr) {
            try {
              const pendingAuth = JSON.parse(pendingAuthStr);
              const age = Date.now() - pendingAuth.timestamp;

              // Solo procesar si es menor a 5 minutos
              if (age < 300000 && pendingAuth.uid === firebaseUser.uid) {
                console.log('🔄 Attempting to recover pending authentication...');
                const { getUserBusinessAccess } = await import('@/lib/database');

                try {
                  const businessAccess = await getUserBusinessAccess(pendingAuth.email, pendingAuth.uid);

                  if (businessAccess.hasAccess) {
                    let businessId = null;
                    if (businessAccess.ownedBusinesses.length > 0) {
                      businessId = businessAccess.ownedBusinesses[0].id;
                    } else if (businessAccess.adminBusinesses.length > 0) {
                      businessId = businessAccess.adminBusinesses[0].id;
                    }

                    if (businessId) {
                      currentBusinessId = businessId;
                      currentOwnerId = firebaseUser.uid;
                      localStorage.setItem('businessId', currentBusinessId);
                      localStorage.setItem('ownerId', currentOwnerId);
                      localStorage.setItem('currentBusinessId', currentBusinessId);
                      localStorage.removeItem('pendingAuth'); // Limpiar
                      console.log('✅ Pending authentication recovered successfully!');
                    }
                  }
                } catch (err) {
                  console.error('[Auth] Failed to recover pending auth:', err);
                  // No limpiar pendingAuth aquí, puede ser que la conexión siga lenta
                }
              } else if (age >= 300000) {
                // Expirado, limpiar
                console.log('⏰ Pending auth expired, clearing');
                localStorage.removeItem('pendingAuth');
              }
            } catch (err) {
              console.error('[Auth] Error parsing pending auth:', err);
              localStorage.removeItem('pendingAuth');
            }
          }

          // Si aún no tenemos datos, intentar recuperar de la DB
          if (!currentBusinessId || !currentOwnerId) {
            try {
              const { getBusinessByOwner } = await import('@/lib/database');
              const biz = await getBusinessByOwner(firebaseUser.uid);
              if (biz) {
                currentBusinessId = biz.id;
                currentOwnerId = biz.ownerId || firebaseUser.uid;
                // Guardar para evitar repetir la búsqueda
                localStorage.setItem('businessId', currentBusinessId);
                localStorage.setItem('ownerId', currentOwnerId);
                localStorage.setItem('currentBusinessId', currentBusinessId);
              }
            } catch (err) {
              console.error('[Auth] Error during session recovery:', err);
            }
          }
        }

        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL
        })
        setBusinessIdState(currentBusinessId)
        setOwnerIdState(currentOwnerId)
        setAuthLoading(false)

        if (currentBusinessId && currentOwnerId) {
        } else {
          console.warn('[Auth] Firebase user logged in but no business found');
        }
      } else {
        // Si el usuario no está autenticado en Firebase, limpiar todo
        setUser(null)
        setBusinessIdState(null)
        setOwnerIdState(null)
        localStorage.removeItem('businessId')
        localStorage.removeItem('ownerId')
        localStorage.removeItem('currentBusinessId')
        localStorage.removeItem('pendingAuth') // También limpiar pending auth
        setAuthLoading(false)
      }
    })

    return () => unsubscribe()
  }, [])

  const login = async (userData: BusinessUser, businessIdParam: string, ownerIdParam: string) => {
    setUser(userData)
    setBusinessIdState(businessIdParam)
    setOwnerIdState(ownerIdParam)

    // Persistir en localStorage
    localStorage.setItem('businessId', businessIdParam)
    localStorage.setItem('ownerId', ownerIdParam)
    localStorage.setItem('currentBusinessId', businessIdParam)

    // Actualizar fecha de último login en el negocio
    try {
      const { updateBusiness, serverTimestamp } = await import('@/lib/database');
      await updateBusiness(businessIdParam, {
        lastLoginAt: serverTimestamp(),
        loginSource: 'business_portal'
      });
    } catch (err) {
      console.error('[Auth] Error updating business lastLoginAt:', err);
    }
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
