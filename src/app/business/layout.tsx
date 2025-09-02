import type { Metadata } from 'next'
import { BusinessLayoutWrapper } from '@/components/BusinessLayoutWrapper'

export const metadata: Metadata = {
  title: 'Dashboard - fuddi.shop Business',
  description: 'Panel de administración para negocios de fuddi.shop',
}

export default function BusinessLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <BusinessLayoutWrapper>{children}</BusinessLayoutWrapper>
}
