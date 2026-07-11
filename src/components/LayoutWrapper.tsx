'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
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

  return (
    <>
      <main className="min-h-[calc(100vh+1px)]">
        {children}
      </main>
      <BottomNavigation />
    </>
  )
}
