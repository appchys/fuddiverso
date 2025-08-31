import type { Metadata } from 'next'
import './globals.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import { AuthProvider } from '@/contexts/AuthContext'
import Header from '@/components/Header'

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
        <AuthProvider>
          <Header />
          <main className="min-h-screen pt-16">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  )
}
