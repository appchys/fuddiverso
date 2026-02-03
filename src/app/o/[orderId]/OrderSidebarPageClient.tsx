'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import OrderSidebar from '@/components/OrderSidebar'

type Props = {
  orderId: string
}

export default function OrderSidebarPageClient({ orderId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(true)

  const handleClose = useCallback(() => {
    setOpen(false)
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push('/')
  }, [router])

  return (
    <main className="min-h-screen bg-gray-50">
      <OrderSidebar isOpen={open} onClose={handleClose} orderId={orderId} />
    </main>
  )
}
