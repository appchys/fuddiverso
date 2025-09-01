'use client'

import { usePathname } from 'next/navigation'
import Header from './Header'

export default function LayoutWrapper({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  
  // No agregar padding top en rutas de business ya que tienen su propio header
  const isBusinessRoute = pathname.startsWith('/business')

  return (
    <>
      <Header />
      <main className={`min-h-screen ${!isBusinessRoute ? 'pt-16' : ''}`}>
        {children}
      </main>
    </>
  )
}
