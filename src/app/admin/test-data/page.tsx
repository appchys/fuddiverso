'use client'

import { useState } from 'react'
import { getAllOrders, getAllBusinesses } from '@/lib/database'

export default function TestDataPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [businesses, setBusinesses] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const testLoadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [allOrders, allBusinesses] = await Promise.all([
        getAllOrders(),
        getAllBusinesses()
      ])
      setOrders(allOrders)
      setBusinesses(allBusinesses)
    } catch (err: any) {
      console.error('Error loading data:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">Test Data Loading</h1>
        
        <button
          onClick={testLoadData}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 mb-8"
        >
          {loading ? 'Loading...' : 'Test Load Data'}
        </button>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-8">
            Error: {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Orders */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Orders ({orders.length})
            </h2>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {orders.map((order, index) => (
                <div key={order.id || index} className="border border-gray-200 rounded p-3">
                  <div className="text-sm">
                    <div><strong>ID:</strong> {order.id}</div>
                    <div><strong>Customer:</strong> {order.customer?.name}</div>
                    <div><strong>Phone:</strong> {order.customer?.phone}</div>
                    <div><strong>Total:</strong> ${order.total}</div>
                    <div><strong>Status:</strong> {order.status}</div>
                    <div><strong>Business ID:</strong> {order.businessId}</div>
                    <div><strong>Created:</strong> {order.createdAt ? new Date(order.createdAt).toLocaleString() : 'N/A'}</div>
                    <div><strong>Items:</strong> {order.items?.length || 0}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Businesses */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Businesses ({businesses.length})
            </h2>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {businesses.map((business, index) => (
                <div key={business.id || index} className="border border-gray-200 rounded p-3">
                  <div className="text-sm">
                    <div><strong>ID:</strong> {business.id}</div>
                    <div><strong>Name:</strong> {business.name}</div>
                    <div><strong>Address:</strong> {business.address}</div>
                    <div><strong>Phone:</strong> {business.phone}</div>
                    <div><strong>Category:</strong> {business.category}</div>
                    <div><strong>Created:</strong> {business.createdAt ? new Date(business.createdAt).toLocaleString() : 'N/A'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
