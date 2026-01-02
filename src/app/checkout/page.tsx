'use client'

import { Suspense } from 'react'
import { CheckoutContent } from '@/components/CheckoutContent'

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
            <p className="mt-4 text-gray-600">Cargando checkout...</p>
          </div>
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  )
}