'use client'

import { useState } from 'react'
import { testFirebaseConnection } from '@/lib/firebase-test'

export default function FirebaseTestPage() {
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const runTest = async () => {
    setLoading(true)
    setResult(null)
    
    try {
      const testResult = await testFirebaseConnection()
      setResult(testResult)
    } catch (error) {
      setResult({ success: false, error: String(error) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Firebase Connection Test
        </h1>
        
        <div className="bg-white rounded-lg shadow-md p-6">
          <button
            onClick={runTest}
            disabled={loading}
            className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? 'Testing...' : 'Test Firebase Connection'}
          </button>
          
          {result && (
            <div className={`mt-6 p-4 rounded-lg ${
              result.success 
                ? 'bg-green-100 border border-green-400 text-green-700'
                : 'bg-red-100 border border-red-400 text-red-700'
            }`}>
              {result.success ? (
                <div>
                  <h3 className="font-semibold">✅ Success!</h3>
                  <p>{result.message}</p>
                  <div className="mt-2 text-sm">
                    <p>• Test document ID: {result.docId}</p>
                    <p>• Existing businesses found: {result.businessesCount}</p>
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="font-semibold">❌ Error Details</h3>
                  {result.error && (
                    <div className="mt-2 text-sm">
                      <p><strong>Error Name:</strong> {result.error.name}</p>
                      <p><strong>Error Code:</strong> {result.error.code}</p>
                      <p><strong>Message:</strong> {result.error.message}</p>
                      <details className="mt-2">
                        <summary className="cursor-pointer font-medium">Full Error (click to expand)</summary>
                        <pre className="mt-2 text-xs bg-gray-800 text-white p-2 rounded overflow-auto max-h-32">
                          {result.fullError}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          <div className="mt-8">
            <h2 className="text-xl font-semibold mb-4">Current Firebase Config:</h2>
            <div className="bg-gray-100 p-4 rounded-lg text-sm">
              <p><strong>Project ID:</strong> fuddiverso</p>
              <p><strong>API Key:</strong> AIzaSyDv-Gt0QrB0VlXsDEMfPpXCRbYIfi_2hLA</p>
              <p><strong>Auth Domain:</strong> fuddiverso.firebaseapp.com</p>
              <p><strong>Storage Bucket:</strong> fuddiverso.firebasestorage.app</p>
            </div>
          </div>
          
          <div className="mt-6">
            <h3 className="font-semibold mb-2">Common Issues:</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>1. Check if Firebase project exists and is active</li>
              <li>2. Verify Firebase rules allow read/write operations</li>
              <li>3. Ensure API key is correct and not restricted</li>
              <li>4. Check if Firestore is enabled in Firebase console</li>
              <li>5. Verify Storage is enabled if using file uploads</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
