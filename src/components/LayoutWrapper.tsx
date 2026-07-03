'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Header from './Header'
import BottomNavigation from './BottomNavigation'

export default function LayoutWrapper({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? ''

  useEffect(() => {
    // Prevent pinch-to-zoom gestures on mobile devices
    const preventZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault()
      }
    }

    const preventGesture = (e: Event) => {
      e.preventDefault()
    }

    document.addEventListener('touchstart', preventZoom, { passive: false })
    document.addEventListener('gesturestart', preventGesture)

    // Attempt to hide mobile browser address bar on load
    const hideAddressBar = () => {
      window.scrollTo(0, 1)
    }
    const timer = setTimeout(hideAddressBar, 800)

    return () => {
      document.removeEventListener('touchstart', preventZoom)
      document.removeEventListener('gesturestart', preventGesture)
      clearTimeout(timer)
    }
  }, [])

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
      <main className={`min-h-[calc(100vh+1px)] ${showHeader ? 'pt-16' : ''}`}>
        {children}
      </main>
      <BottomNavigation />
    </>
  )
}
