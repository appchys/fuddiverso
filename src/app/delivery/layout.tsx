import { DeliveryAuthProvider } from '@/contexts/DeliveryAuthContext'
import { DeliveryUIProvider } from '@/contexts/DeliveryUIContext'
import DeliveryHeader from '@/components/DeliveryHeader'
import DeliverySidebar from '@/components/DeliverySidebar'

export default function DeliveryLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DeliveryAuthProvider>
      <DeliveryUIProvider>
        <DeliveryHeader />
        <DeliverySidebar />
        <div className="min-h-screen bg-gray-50">
          {children}
        </div>
      </DeliveryUIProvider>
    </DeliveryAuthProvider>
  )
}
