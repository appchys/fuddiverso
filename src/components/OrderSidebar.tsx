'use client'

import Link from 'next/link'
import OrderPublicClient from '@/app/o/[orderId]/OrderPublicClient'

interface OrderSidebarProps {
  isOpen: boolean
  onClose: () => void
  orderId: string | null
}

export default function OrderSidebar({ isOpen, onClose, orderId }: OrderSidebarProps) {
  if (!isOpen || !orderId) return null

  return (
    <div className="fixed inset-0 z-[120] overflow-hidden">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      <div className="absolute right-0 top-0 h-full w-full sm:w-[500px] bg-white shadow-2xl transform transition-transform duration-300">
        <div className="h-full overflow-y-auto scrollbar-hide">
          <div className="min-h-full flex flex-col">
            <div className="px-6 pt-6 pb-4 bg-white sticky top-0 z-10 border-b border-gray-100 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={onClose}
                    className="p-2 -ml-2 text-gray-800 hover:bg-gray-100 rounded-full transition-colors"
                    aria-label="Cerrar"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <h3 className="text-lg font-bold text-gray-900 truncate">Tu pedido</h3>
                </div>

                <Link
                  href={`/o/${orderId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-xl bg-gray-900 text-white hover:bg-gray-800 transition-colors"
                >
                  Abrir link
                </Link>
              </div>
            </div>

            <div className="flex-1">
              <OrderPublicClient orderId={orderId} embedded />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
