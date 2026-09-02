import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pedidos - Fuddi.shop',
  description: 'Gestión de pedidos en tiempo real - Fuddi.shop',
}

export default function PedidosLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
