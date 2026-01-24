'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * Esta página recibe el clientId desde el email y lo redirige
 * a la página de monitoreo con los parámetros correctos
 */
export default function CheckoutMonitorRedirectPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  useEffect(() => {
    // El clientId viene en el pathname desde el email
    // Redirigimos a la página con businessId si está disponible
    const pathname = window.location.pathname
    const clientIdMatch = pathname.match(/checkout-monitor\/([^/]+)/)
    const clientId = clientIdMatch?.[1]
    
    // Intentar obtener businessId del localStorage (si existe alguno abierto)
    let businessId = searchParams.get('businessId')
    
    if (!businessId) {
      // Si no hay businessId en la query, buscar en localStorage
      try {
        const cartsData = localStorage.getItem('carts')
        if (cartsData) {
          const carts = JSON.parse(cartsData)
          // Usar el primer negocio disponible
          const firstBusinessId = Object.keys(carts)[0]
          if (firstBusinessId) {
            businessId = firstBusinessId
          }
        }
      } catch (e) {
        console.error('Error reading carts from localStorage:', e)
      }
    }
    
    if (clientId && businessId) {
      router.push(`/admin/checkout-monitor/${clientId}?businessId=${businessId}`)
    }
  }, [router, searchParams])

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-red-500"></div>
        <p className="mt-4 text-gray-600">Cargando monitor de checkout...</p>
      </div>
    </div>
  )
}
