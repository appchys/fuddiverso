import type { Metadata } from 'next'
import './globals.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import { AuthProvider } from '@/contexts/AuthContext'
import LayoutWrapper from '@/components/LayoutWrapper'
import { Analytics } from "@vercel/analytics/next"

export const metadata: Metadata = {
  title: 'Fuddi',
  description: 'Plataforma de delivery de comida para negocios y clientes',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
      </head>
      <body className="bg-gray-50 min-h-screen">
        <AuthProvider>
          <LayoutWrapper>
            {children}
          </LayoutWrapper>
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  )
}
