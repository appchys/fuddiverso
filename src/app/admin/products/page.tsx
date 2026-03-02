'use client'

import ProductsList from '@/components/ProductsList'
import { useEffect } from 'react'

export default function AdminProductsPage() {
  useEffect(() => {
    document.title = 'Productos - Panel de administración - Fuddi'
  }, [])

  return (
    <div>
      <ProductsList />
    </div>
  )
}
