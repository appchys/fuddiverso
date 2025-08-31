'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { FirestoreClient } from '@/lib/database'

interface AuthContextType {
  user: FirestoreClient | null
  login: (user: FirestoreClient) => void
  logout: () => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirestoreClient | null>(null)

  useEffect(() => {
    // Cargar usuario desde localStorage al iniciar
    const savedUser = localStorage.getItem('fuddiverso_user')
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser))
      } catch (error) {
        console.error('Error parsing saved user:', error)
        localStorage.removeItem('fuddiverso_user')
      }
    }
  }, [])

  const login = (userData: FirestoreClient) => {
    setUser(userData)
    localStorage.setItem('fuddiverso_user', JSON.stringify(userData))
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('fuddiverso_user')
  }

  return (
    <AuthContext.Provider value={{
      user,
      login,
      logout,
      isAuthenticated: !!user
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
