import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dashboard - Fuddiverso Business',
  description: 'Panel de administración para negocios de Fuddiverso',
}

export default function BusinessLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {children}
    </>
  )
}
