'use client'

import { Suspense } from 'react'
import QRCodesContent from '@/app/business/qr-codes/qr-codes-content'

export default function QRCodesManagementPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-gray-600">Cargando...</div>}>
      <QRCodesContent />
    </Suspense>
  )
}