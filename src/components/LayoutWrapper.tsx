'use client'

import { usePathname } from 'next/navigation'
import Header from './Header'

export default function LayoutWrapper({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Rutas reservadas que NO son perfiles de tienda
  const reservedRoutes = [
    'checkout', 'profile', 'my-orders', 'my-locations',
    'collection', 'restaurants', 'scan', 'delivery', 'admin', 'o', 'business'
  ]

  const pathSegments = pathname.split('/').filter(Boolean)

  // Es una ruta de tienda si tiene al menos un segmento y el primero no es una ruta reservada
  const isStoreRoute = pathSegments.length > 0 && !reservedRoutes.includes(pathSegments[0])

  // No mostrar header en rutas de business, checkout ni en perfiles de tienda
  const isBusinessRoute = pathname.startsWith('/business')
  const isCheckoutRoute = pathname === '/checkout'
  const showHeader = !isBusinessRoute && !isCheckoutRoute && !isStoreRoute

  return (
    <>
      {showHeader && <Header />}
      <main className={`min-h-screen ${showHeader ? 'pt-16' : ''}`}>
        {children}
      </main>
    </>
  )
}
