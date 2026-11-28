'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import OrderSidebar from '@/components/OrderSidebar'

type Props = {
  orderId: string
  initialOrder?: any | null
}

export default function OrderSidebarPageClient({ orderId, initialOrder }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const [businessSlug, setBusinessSlug] = useState<string | null>(
    initialOrder?.businessSnapshot?.username || initialOrder?.businessId || null
  )

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
      <OrderSidebar
        isOpen={open}
        onClose={handleClose}
        orderId={orderId}
        initialOrder={initialOrder}
        onBusinessSlug={setBusinessSlug}
      />
    </main>
  )
}
