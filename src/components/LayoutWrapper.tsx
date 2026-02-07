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
    'collection', 'restaurants', 'restaurant', 'scan', 'delivery', 'admin', 'o', 'business'
  ]

  const pathSegments = pathname.split('/').filter(Boolean)

  // Es la página principal de una tienda (ej: /munchys) si tiene exactamente 1 segmento y no es una ruta reservada
  const isStoreHomePage = pathSegments.length === 1 && !reservedRoutes.includes(pathSegments[0])

  // No mostrar header en rutas de business, delivery, checkout ni en la página principal de la tienda
  const isBusinessRoute = pathname.startsWith('/business')
  const isDeliveryRoute = pathname.startsWith('/delivery')
  const isCheckoutRoute = pathname === '/checkout'
  const isAdminRoute = pathname.startsWith('/admin')
  const showHeader = !isBusinessRoute && !isDeliveryRoute && !isCheckoutRoute && !isStoreHomePage && !isAdminRoute

  return (
    <>
      {showHeader && <Header />}
      <main className={`min-h-screen ${showHeader ? 'pt-16' : ''}`}>
        {children}
      </main>
    </>
  )
}
