import type { Metadata } from 'next'
import Script from 'next/script'

export const metadata: Metadata = {
  title: 'Fuddi TMA Admin',
  description: 'Telegram Mini App para administración de pedidos',
}

export default function TMALayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Script 
        src="https://telegram.org/js/telegram-web-app.js" 
        strategy="beforeInteractive" 
      />
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
        {children}
      </div>
    </>
  )
}
