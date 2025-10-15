import React from 'react'
import OrderPublicClient from './OrderPublicClient'

type Props = {
  params: Promise<{ orderId: string }>
}

export default async function Page({ params }: Props) {
  const { orderId } = await params
  return (
    <main className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <OrderPublicClient orderId={orderId} />
      </div>
    </main>
  )
}
