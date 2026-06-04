'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Business } from '@/types'
import { auth } from '@/lib/firebase'
import { ExpenseEntry, deleteExpense, getExpensesByBusiness } from '@/lib/database'

interface FinanceViewProps {
  business: Business | null
  user: any
}

interface GmailStatus {
  connected: boolean
  configured: boolean
  canLabelMessages: boolean
  missingConfig: string[]
  connectedEmail?: string | null
  lastImportCount?: number
}

export default function FinanceView({ business, user }: FinanceViewProps) {
  const [status, setStatus] = useState<GmailStatus | null>(null)
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const xmlExpenses = useMemo(() => {
    return expenses.filter((expense: any) => expense.source === 'gmail_xml').slice(0, 8)
  }, [expenses])

  const getToken = async () => {
    const currentUser = auth.currentUser
    if (!currentUser) throw new Error('No hay usuario autenticado.')
    return currentUser.getIdToken()
  }

  const loadData = async () => {
    if (!business?.id) return

    setLoading(true)
    setError('')
    try {
      const token = await getToken()
      const [statusResponse, expenseData] = await Promise.all([
        fetch(`/api/finance/gmail/status?businessId=${business.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        getExpensesByBusiness(business.id)
      ])

      const statusData = await statusResponse.json()
      if (!statusResponse.ok) throw new Error(statusData.error || 'No se pudo cargar Gmail.')

      setStatus(statusData)
      setExpenses(expenseData)
    } catch (err: any) {
      setError(err.message || 'No se pudo cargar Finanzas.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [business?.id])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const gmail = params.get('gmail')
    if (gmail === 'connected') {
      setMessage('Gmail conectado correctamente. Importando compras XML...')
      window.setTimeout(() => {
        importPurchases()
      }, 500)
    } else if (gmail === 'error') {
      setError('No se pudo conectar Gmail. Revisa la configuracion o intenta nuevamente.')
    }
  }, [])

  const connectGmail = async () => {
    if (!business?.id) return

    setLoading(true)
    setError('')
    setMessage('')
    try {
      const token = await getToken()
      const response = await fetch(`/api/finance/gmail/connect?businessId=${business.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar la conexion.')
      window.location.href = data.authUrl
    } catch (err: any) {
      setError(err.message || 'No se pudo conectar Gmail.')
      setLoading(false)
    }
  }

  const importPurchases = async () => {
    if (!business?.id) return

    setImporting(true)
    setError('')
    setMessage('')
    try {
      const token = await getToken()
      const response = await fetch(`/api/finance/gmail/import?businessId=${business.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'No se pudo importar.')

      setMessage(`Importacion completa: ${data.importedCount} compras nuevas, ${data.skippedCount} omitidas.`)
      await loadData()
    } catch (err: any) {
      setError(err.message || 'No se pudieron importar compras.')
    } finally {
      setImporting(false)
    }
  }

  const deleteImportedPurchase = async (expense: ExpenseEntry) => {
    if (!expense.id) return
    if (!confirm(`Eliminar esta compra importada?\n\n${expense.concept}\n$${expense.amount.toFixed(2)}`)) return

    setError('')
    setMessage('')
    try {
      await deleteExpense(expense.id)
      setExpenses(prev => prev.filter(item => item.id !== expense.id))
      setMessage('Compra importada eliminada.')
    } catch (err: any) {
      setError(err.message || 'No se pudo eliminar la compra importada.')
    }
  }

  if (!business) return null

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Finanzas</h2>
          <p className="text-sm text-gray-500">Conecta Gmail para registrar compras desde archivos XML o ZIP.</p>
        </div>
        <button
          onClick={status?.connected && status.canLabelMessages ? importPurchases : connectGmail}
          disabled={loading || importing}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          <i className={`bi ${status?.connected && status.canLabelMessages ? 'bi-cloud-download' : 'bi-google'}`}></i>
          {status?.connected && status.canLabelMessages
            ? (importing ? 'Importando...' : 'Importar XML')
            : (status?.connected ? 'Reconectar Gmail' : 'Conectar Gmail')}
        </button>
      </div>

      {(message || error) && (
        <div className={`rounded-lg border p-4 text-sm font-medium ${
          error ? 'bg-red-50 border-red-100 text-red-700' : 'bg-green-50 border-green-100 text-green-700'
        }`}>
          {error || message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Gmail</p>
              <h3 className="mt-1 text-lg font-bold text-gray-900">
                {status?.connected ? 'Conectado' : 'Sin conectar'}
              </h3>
            </div>
            <div className={`w-11 h-11 rounded-full flex items-center justify-center ${
              status?.connected ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'
            }`}>
              <i className={`bi ${status?.connected ? 'bi-check2-circle' : 'bi-envelope'} text-xl`}></i>
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-500">
            {status?.connected && status.canLabelMessages
              ? 'La aplicacion puede leer XML, abrir ZIP y etiquetar correos procesados como Importado.'
              : status?.connected
                ? 'Reconecta Gmail para permitir la etiqueta Importado en correos procesados.'
              : 'Autoriza una cuenta de Gmail para empezar a importar facturas XML o ZIP.'}
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Compras XML</p>
          <p className="mt-1 text-3xl font-black text-gray-900">{xmlExpenses.length}</p>
          <p className="mt-2 text-sm text-gray-500">Registros recientes creados desde Gmail.</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Configuracion</p>
          <p className={`mt-1 text-lg font-bold ${status?.configured ? 'text-green-600' : 'text-amber-600'}`}>
            {status?.configured ? 'Lista' : 'Pendiente'}
          </p>
          {!status?.configured && (
            <p className="mt-2 text-sm text-gray-500">
              Faltan: {status?.missingConfig?.join(', ') || 'variables OAuth'}.
            </p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-900">Compras importadas</h3>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            title="Actualizar"
          >
            <i className="bi bi-arrow-clockwise"></i>
          </button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-gray-500">Cargando...</div>
        ) : xmlExpenses.length === 0 ? (
          <div className="p-10 text-center text-gray-500">Aun no hay compras XML importadas.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-xs font-bold text-gray-400 uppercase">Fecha</th>
                  <th className="px-5 py-3 text-xs font-bold text-gray-400 uppercase">Detalle</th>
                  <th className="px-5 py-3 text-xs font-bold text-gray-400 uppercase text-right">Monto</th>
                  <th className="px-5 py-3 text-xs font-bold text-gray-400 uppercase text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {xmlExpenses.map(expense => (
                  <tr key={expense.id} className="group">
                    <td className="px-5 py-4 text-sm text-gray-500">{expense.date}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-gray-900">{expense.concept}</td>
                    <td className="px-5 py-4 text-sm font-bold text-red-600 text-right">
                      -${expense.amount.toFixed(2)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => deleteImportedPurchase(expense)}
                        className="p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all sm:opacity-0 sm:group-hover:opacity-100"
                        title="Eliminar compra importada"
                      >
                        <i className="bi bi-trash"></i>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
