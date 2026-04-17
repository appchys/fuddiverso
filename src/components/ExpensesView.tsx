'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Business } from '@/types'
import { getExpensesByBusiness, ExpenseEntry, createExpense, deleteExpense } from '@/lib/database'

interface ExpensesViewProps {
  business: Business | null
  user: any
}

// Helper function to get the current date in Ecuador (UTC-5)
const getEcuadorDate = () => {
  const now = new Date()
  const offset = -5 // Ecuador is UTC-5
  const ecuadorTime = new Date(now.getTime() + (offset * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000))
  return ecuadorTime.toISOString().split('T')[0]
}

export default function ExpensesView({ business, user }: ExpensesViewProps) {
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newExpense, setNewExpense] = useState({
    amount: '',
    concept: '',
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    date: getEcuadorDate()
  })

  const loadExpenses = async () => {
    if (!business?.id) return
    setLoading(true)
    try {
      const data = await getExpensesByBusiness(business.id)
      setExpenses(data)
    } catch (error) {
      console.error('Error loading expenses:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadExpenses()
  }, [business?.id])

  const groupedExpenses = useMemo(() => {
    const groups: { [date: string]: ExpenseEntry[] } = {}
    expenses.forEach(e => {
      if (!groups[e.date]) groups[e.date] = []
      groups[e.date].push(e)
    })
    // Sort dates descending
    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map(date => ({
        date,
        items: groups[date],
        total: groups[date].reduce((sum, item) => sum + (item.amount || 0), 0)
      }))
  }, [expenses])

  const [expandedDates, setExpandedDates] = useState<string[]>([])

  useEffect(() => {
    // Expand today by default if there are expenses
    const today = getEcuadorDate()
    if (groupedExpenses.length > 0 && !expandedDates.includes(today)) {
      setExpandedDates([today])
    }
  }, [groupedExpenses.length])

  const toggleDate = (date: string) => {
    setExpandedDates(prev =>
      prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!business?.id || !user) return

    try {
      const amount = parseFloat(newExpense.amount)
      if (isNaN(amount) || amount <= 0) {
        alert('El monto debe ser mayor a 0')
        return
      }

      await createExpense({
        businessId: business.id,
        concept: newExpense.concept,
        amount: amount,
        paymentMethod: newExpense.paymentMethod as any,
        paymentStatus: newExpense.paymentStatus as any,
        date: newExpense.date,
        registeredBy: user.displayName || user.email || 'Usuario',
        registeredById: user.uid
      })

      // Reload and Reset
      loadExpenses()
      setNewExpense({
        amount: '',
        concept: '',
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        date: getEcuadorDate()
      })
      setShowAddForm(false)
    } catch (error) {
      console.error('Error creating expense:', error)
      alert('Error al registrar el gasto')
    }
  }

  const handleDelete = async (id: string, date: string) => {
    if (!confirm('¿Estás seguro de eliminar este gasto?')) return
    try {
      await deleteExpense(id)
      setExpenses(prev => prev.filter(e => e.id !== id))
    } catch (error) {
      console.error('Error deleting expense:', error)
      alert('Error al eliminar el gasto')
    }
  }

  if (!business) return null

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Gastos</h2>
          <p className="text-sm text-gray-500">Administra los egresos de tu negocio</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition-all ${
            showAddForm ? 'bg-gray-100 text-gray-600' : 'bg-red-600 text-white shadow-lg shadow-red-200'
          }`}
        >
          <i className={`bi ${showAddForm ? 'bi-x-lg' : 'bi-plus-lg'}`}></i>
          {showAddForm ? 'Cancelar' : 'Registrar Gasto'}
        </button>
      </div>

      {showAddForm && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm animate-in fade-in slide-in-from-top-4 duration-300">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Concepto / Detalle</label>
                <input
                  list="expense-concepts"
                  type="text"
                  required
                  value={newExpense.concept}
                  onChange={e => setNewExpense({ ...newExpense, concept: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none transition-all"
                  placeholder="Ej: Pago de arriendo, Compra de insumos..."
                />
                <datalist id="expense-concepts">
                  {expenseConcepts.map((concept, i) => (
                    <option key={i} value={concept} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Monto ($)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={newExpense.amount}
                  onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none transition-all"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Fecha</label>
                <input
                  type="date"
                  required
                  value={newExpense.date}
                  onChange={e => setNewExpense({ ...newExpense, date: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Método de Pago</label>
                <select
                  value={newExpense.paymentMethod}
                  onChange={e => setNewExpense({ ...newExpense, paymentMethod: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none transition-all"
                >
                  <option value="cash">Efectivo</option>
                  <option value="transfer">Transferencia</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Estado de Pago</label>
                <select
                  value={newExpense.paymentStatus}
                  onChange={e => setNewExpense({ ...newExpense, paymentStatus: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none transition-all"
                >
                  <option value="paid">Pagado</option>
                  <option value="pending">Pendiente</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full py-2 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all"
                >
                  Guardar Gasto
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mx-auto"></div>
        </div>
      ) : groupedExpenses.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-500 shadow-sm">
          No hay gastos registrados
        </div>
      ) : (
        <div className="space-y-4">
          {groupedExpenses.map(group => (
            <div key={group.date} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-all">
              <button
                onClick={() => toggleDate(group.date)}
                className="w-full px-6 py-4 flex justify-between items-center hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${expandedDates.includes(group.date) ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-400'}`}>
                    <i className={`bi bi-chevron-${expandedDates.includes(group.date) ? 'down' : 'right'}`}></i>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-gray-900 capitalize">
                      {new Date(group.date + 'T00:00:00').toLocaleDateString('es-EC', {
                        weekday: 'long',
                        day: '2-digit',
                        month: 'long'
                      })}
                    </p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                      {group.items.length} {group.items.length === 1 ? 'Gasto' : 'Gastos'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-red-600">-${group.total.toFixed(2)}</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest italic">Total Día</p>
                </div>
              </button>

              {expandedDates.includes(group.date) && (
                <div className="border-t border-gray-50 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50/50">
                        <tr>
                          <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Detalle</th>
                          <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Método</th>
                          <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Estado</th>
                          <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Monto</th>
                          <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {group.items.map((expense) => (
                          <tr key={expense.id} className="hover:bg-gray-50/30 transition-colors group">
                            <td className="px-6 py-4">
                              <p className="text-sm font-bold text-gray-900">{expense.concept}</p>
                              <p className="text-[10px] text-gray-400 uppercase tracking-tight">
                                Por: {expense.registeredBy || 'Sistema'}
                              </p>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-xs font-semibold text-gray-600 bg-gray-100 px-2 py-1 rounded-lg">
                                {expense.paymentMethod === 'cash' ? 'Efectivo' : 'Transferencia'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-lg ${
                                expense.paymentStatus === 'paid' 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-yellow-100 text-yellow-700'
                              }`}>
                                {expense.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <p className="text-sm font-bold text-red-600">
                                -${expense.amount.toFixed(2)}
                              </p>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => handleDelete(expense.id!, group.date)}
                                className="p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                              >
                                <i className="bi bi-trash"></i>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
