'use client'

import { useEffect } from 'react'
import OrderPublicClient from '@/app/o/[orderId]/OrderPublicClient'

interface OrderSidebarProps {
  isOpen: boolean
  onClose: () => void
  orderId: string | null
}

export default function OrderSidebar({ isOpen, onClose, orderId }: OrderSidebarProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen || !orderId) return null

  const handleCopyLink = async () => {
    const orderUrl = `${window.location.origin}/o/${orderId}`
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(orderUrl)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = orderUrl
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
    } catch (e) {
      console.error('Error copying order link:', e)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] overflow-hidden">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      <div
        className={`fixed right-0 top-0 h-full w-full sm:w-[500px] bg-white shadow-2xl transform transition-all duration-300 ease-in-out z-[130] ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="h-full overflow-y-auto scrollbar-hide">
          <div className="min-h-full flex flex-col">
            <div className="absolute top-3 left-3 right-3 z-20 bg-transparent pointer-events-none">
              <div className="flex items-center justify-between pointer-events-auto">
                <button
                  onClick={onClose}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Cerrar"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Copiar enlace"
                >
                  <i className="bi bi-link-45deg text-xl"></i>
                </button>
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
