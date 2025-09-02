'use client'

import { BusinessAuthProvider } from '@/contexts/BusinessAuthContext'

interface BusinessLayoutWrapperProps {
  children: React.ReactNode
}

export function BusinessLayoutWrapper({ children }: BusinessLayoutWrapperProps) {
  return (
    <BusinessAuthProvider>
      {children}
    </BusinessAuthProvider>
  )
}
