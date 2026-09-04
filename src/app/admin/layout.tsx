import type { Metadata } from 'next'
import AdminLayoutClient from './AdminLayoutClient'

export const metadata: Metadata = {
  title: 'Admin - Fuddi.shop',
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>
}
