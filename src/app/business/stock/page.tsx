'use client'

import { useEffect, useState } from 'react'
import { useBusinessAuth } from '@/contexts/BusinessAuthContext'
import { getBusiness } from '@/lib/database'
import IngredientStockManagement from '@/components/IngredientStockManagement'
import Link from 'next/link'
import { Business } from '@/types'

export default function StockPage() {
  const { businessId, authLoading, isAuthenticated } = useBusinessAuth()
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!businessId) {
      setLoading(false)
      return
    }

    const loadBusiness = async () => {
      try {
        const biz = await getBusiness(businessId)
        setBusiness(biz)
      } catch (error) {
        console.error('Error loading business:', error)
      } finally {
        setLoading(false)
      }
    }

    loadBusiness()
  }, [businessId])

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated || !business) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">No autorizado</h1>
          <p className="text-gray-600 mb-4">Debes iniciar sesión para acceder a esta página</p>
          <Link href="/business/login" className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
            Ir a Login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <IngredientStockManagement business={business} />
  )
}
