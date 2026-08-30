'use client'

import React, { useEffect } from 'react'
import { Business } from '@/types'
import { X } from 'lucide-react'
import StoreRatingsView from './StoreRatingsView'

interface StoreRatingModalProps {
  isOpen: boolean
  onClose: () => void
  business: Business
  clientPhone: string | null
  clientUser: any
  businessUser: any
  businessOwnerId: string | null
  onSuccess?: (message: string) => void
}

export default function StoreRatingModal({
  isOpen,
  onClose,
  business,
  clientPhone,
  clientUser,
  businessUser,
  businessOwnerId,
  onSuccess
}: StoreRatingModalProps) {
  useEffect(() => {
    if (!isOpen) return
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-hidden animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-lg bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-[92vh] sm:h-[85vh] border border-gray-100 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 z-10">

        {/* Cabecera del Modal */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white z-10 flex-shrink-0">
          <div>
            <h3 className="text-base font-black text-gray-900 tracking-tight leading-tight">
              Opiniones de la tienda
            </h3>
            <p className="text-xs font-medium text-gray-500 truncate max-w-xs mt-0.5">
              {business.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-900 flex items-center justify-center transition-colors active:scale-95"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 pb-6 no-scrollbar">
          <StoreRatingsView
            business={business}
            clientPhone={clientPhone}
            clientUser={clientUser}
            businessUser={businessUser}
            businessOwnerId={businessOwnerId}
            onSuccess={onSuccess}
            isModal={true}
          />
        </div>
      </div>

      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  )
}
