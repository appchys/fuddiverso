'use client'

import { useEffect, useState, lazy, Suspense } from 'react'

const AdminSettlementsTab = lazy(() => import('@/components/AdminSettlements'))

import {
  getAllOrders,
  getAllBusinesses,
  getAllSettlements,
  getAllDeliveries
} from '@/lib/database'

import type { Business, Delivery, Order, Settlement } from '@/types'

export default function AdminSettlementsPage() {
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<Order[]>([])
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [settlementsHistory, setSettlementsHistory] = useState<Settlement[]>([])

  const loadData = async () => {
    try {
      setLoading(true)
      const [allOrders, allBusinesses, allSettlements, allDeliveries] = await Promise.all([
        getAllOrders(),
        getAllBusinesses(),
        getAllSettlements(),
        getAllDeliveries()
      ])

      setOrders(
        (allOrders || []).filter(order =>
          order &&
          order.id &&
          order.customer &&
          order.customer.name &&
          typeof order.total === 'number' &&
          order.createdAt
        )
      )

      setBusinesses((allBusinesses || []).filter(b => b && b.id && b.name))
      setSettlementsHistory(allSettlements || [])
      setDeliveries(allDeliveries || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    document.title = 'Liquidaciones - Panel de administración'
    loadData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>}>
      <AdminSettlementsTab
        orders={orders}
        setOrders={setOrders}
        businesses={businesses}
        deliveries={deliveries}
        settlementsHistory={settlementsHistory}
        reloadData={loadData}
      />
    </Suspense>
  )
}
