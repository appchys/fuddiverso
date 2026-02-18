'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState, useEffect } from 'react'
import OrderSidebar from '@/components/OrderSidebar'
import { getOrder, getBusiness } from '@/lib/database'

type Props = {
  orderId: string
}

export default function OrderSidebarPageClient({ orderId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const [businessSlug, setBusinessSlug] = useState<string | null>(null)

  useEffect(() => {
    const fetchBusinessSlug = async () => {
      try {
        const order = await getOrder(orderId)
        if (order?.businessId) {
          const business = await getBusiness(order.businessId)
          if (business) {
            setBusinessSlug(business.username || business.id)
          }
        }
      } catch (error) {
        console.error('Error fetching business info for redirect:', error)
      }
    }
    fetchBusinessSlug()
  }, [orderId])

  const handleClose = useCallback(() => {
    setOpen(false)
    if (businessSlug) {
      router.push(`/${businessSlug}`)
    } else {
      router.push('/')
    }
  }, [router, businessSlug])

  return (
    <main className="min-h-screen bg-gray-50">
      <OrderSidebar isOpen={open} onClose={handleClose} orderId={orderId} />
    </main>
  )
}
