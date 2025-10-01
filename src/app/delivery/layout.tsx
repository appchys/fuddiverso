import { DeliveryAuthProvider } from '@/contexts/DeliveryAuthContext'

export default function DeliveryLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DeliveryAuthProvider>
      {children}
    </DeliveryAuthProvider>
  )
}
