import { DeliveryAuthProvider } from '@/contexts/DeliveryAuthContext'
import DeliveryHeader from '@/components/DeliveryHeader'

export default function DeliveryLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DeliveryAuthProvider>
      <DeliveryHeader />
      <div className="min-h-screen bg-gray-50">
        {children}
      </div>
    </DeliveryAuthProvider>
  )
}
