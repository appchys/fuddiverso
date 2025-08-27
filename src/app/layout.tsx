import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fuddiverso - Delivery de Comida',
  description: 'Plataforma de delivery de comida para negocios y clientes',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className="bg-gray-50 min-h-screen">
        {children}
      </body>
    </html>
  )
}
