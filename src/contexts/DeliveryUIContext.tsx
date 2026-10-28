'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

interface DeliveryUIContextType {
  isSidebarOpen: boolean
  openSidebar: () => void
  closeSidebar: () => void
  toggleSidebar: () => void
  activeAssignedOrdersCount: number
  setActiveAssignedOrdersCount: (count: number) => void
}

const DeliveryUIContext = createContext<DeliveryUIContextType | undefined>(undefined)

export function DeliveryUIProvider({ children }: { children: ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [activeAssignedOrdersCount, setActiveAssignedOrdersCount] = useState(0)

  const openSidebar = () => setIsSidebarOpen(true)
  const closeSidebar = () => setIsSidebarOpen(false)
  const toggleSidebar = () => setIsSidebarOpen(prev => !prev)

  return (
    <DeliveryUIContext.Provider
      value={{
        isSidebarOpen,
        openSidebar,
        closeSidebar,
        toggleSidebar,
        activeAssignedOrdersCount,
        setActiveAssignedOrdersCount
      }}
    >
      {children}
    </DeliveryUIContext.Provider>
  )
}

export function useDeliveryUI() {
  const context = useContext(DeliveryUIContext)
  if (!context) {
    throw new Error('useDeliveryUI must be used within a DeliveryUIProvider')
  }
  return context
}
