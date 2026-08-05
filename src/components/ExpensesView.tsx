'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Business } from '@/types'
import { getExpensesByBusiness, ExpenseEntry, createExpense, deleteExpense, updateExpense } from '@/lib/database'

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

  // State for Editing
  const [editingExpense, setEditingExpense] = useState<ExpenseEntry | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

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

// Helper para limpiar y normalizar texto de conceptos
const cleanConceptKey = (str: string): string => {
  if (!str) return ''
  return str
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// Formatea el concepto con mayúscula inicial en cada palabra
const formatConceptDisplay = (str: string): string => {
  const trimmed = str.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  return trimmed
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

  const expenseConcepts = useMemo(() => {
    const conceptMap = new Map<string, string>()
    ;(expenses || []).forEach(e => {
      const raw = e.concept
      if (!raw) return
      const normKey = cleanConceptKey(raw)
      if (!normKey) return
      if (!conceptMap.has(normKey)) {
        conceptMap.set(normKey, formatConceptDisplay(raw))
      }
    })
    return Array.from(conceptMap.values()).sort((a, b) => a.localeCompare(b, 'es'))
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
        concept: newExpense.concept.trim(),
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

  const handleStartEdit = (expense: ExpenseEntry) => {
    setEditingExpense({ ...expense })
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingExpense || !editingExpense.id) return

    const amount = Number(editingExpense.amount)
    if (isNaN(amount) || amount <= 0) {
      alert('El monto debe ser mayor a 0')
      return
    }

    if (!editingExpense.concept.trim()) {
      alert('Ingresa el concepto del gasto')
      return
    }

    setSavingEdit(true)
    try {
      await updateExpense(editingExpense.id, {
        concept: editingExpense.concept.trim(),
        amount,
        date: editingExpense.date,
        paymentMethod: editingExpense.paymentMethod || 'cash',
        paymentStatus: editingExpense.paymentStatus || 'paid'
      })

      await loadExpenses()
      setEditingExpense(null)
    } catch (error) {
      console.error('Error updating expense:', error)
      alert('Error al guardar los cambios del gasto')
    } finally {
      setSavingEdit(false)
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
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl font-bold transition-all shadow-lg shadow-red-200 hover:bg-red-700 active:scale-95 text-sm"
        >
          <i className="bi bi-plus-lg"></i>
          Registrar Gasto
        </button>
      </div>

      {/* Modal de Registro de Nuevo Gasto (Mobile-First Sheet / Desktop Modal) */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl border border-gray-100 p-6 shadow-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto space-y-4 animate-in slide-in-from-bottom-5 sm:zoom-in-95 duration-200">
            {/* Header del Modal */}
            <div className="flex justify-between items-center pb-3 border-b border-gray-100">
              <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                <i className="bi bi-plus-circle-fill text-red-600"></i>
                Registrar Nuevo Gasto
              </h3>

              <div className="flex items-center gap-2">
                {/* Campo de Fecha compacto en la parte superior derecha */}
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-2 py-1 rounded-xl">
                  <i className="bi bi-calendar-event text-red-600 text-xs"></i>
                  <input
                    type="date"
                    required
                    value={newExpense.date}
                    onChange={e => setNewExpense({ ...newExpense, date: e.target.value })}
                    className="bg-transparent text-xs font-bold text-gray-900 outline-none cursor-pointer"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-all"
                >
                  <i className="bi bi-x-lg text-base"></i>
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 pt-1">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Concepto / Detalle</label>
                <input
                  list="expense-concepts"
                  type="text"
                  required
                  value={newExpense.concept}
                  onChange={e => setNewExpense({ ...newExpense, concept: e.target.value })}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none transition-all text-sm font-medium"
                  placeholder="Ej: Pago de arriendo, Compra de insumos..."
                />
                <datalist id="expense-concepts">
                  {expenseConcepts.map((concept, i) => (
                    <option key={i} value={concept} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Monto ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={newExpense.amount}
                    onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none transition-all text-sm font-medium"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Método de Pago</label>
                  <select
                    value={newExpense.paymentMethod}
                    onChange={e => setNewExpense({ ...newExpense, paymentMethod: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none transition-all text-sm font-medium"
                  >
                    <option value="cash">Efectivo</option>
                    <option value="transfer">Transferencia</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Estado de Pago</label>
                <select
                  value={newExpense.paymentStatus}
                  onChange={e => setNewExpense({ ...newExpense, paymentStatus: e.target.value })}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none transition-all text-sm font-medium"
                >
                  <option value="paid">Pagado</option>
                  <option value="pending">Pendiente</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2.5 rounded-xl font-bold text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl font-bold text-sm bg-red-600 text-white hover:bg-red-700 transition-all shadow-md shadow-red-200 flex-1 sm:flex-none"
                >
                  Guardar Gasto
                </button>
              </div>
            </form>
          </div>
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
                          <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Pago</th>
                          <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Monto</th>
                          <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {group.items.map((expense) => (
                          <tr key={expense.id} className="hover:bg-gray-50/30 transition-colors group">
                            <td className="px-6 py-4">
                              <p className="text-sm font-bold text-gray-900">{expense.concept}</p>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border ${
                                expense.paymentStatus === 'paid'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-rose-50 text-rose-700 border-rose-200'
                              }`}>
                                <i className={`bi ${expense.paymentMethod === 'cash' ? 'bi-cash-stack' : 'bi-bank'}`}></i>
                                <span>{expense.paymentMethod === 'cash' ? 'Efectivo' : 'Transferencia'}</span>
                                <span className="text-[10px] opacity-80 font-medium">({expense.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente'})</span>
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <p className="text-sm font-bold text-red-600">
                                -${expense.amount.toFixed(2)}
                              </p>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => handleStartEdit(expense)}
                                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                  title="Editar gasto"
                                >
                                  <i className="bi bi-pencil"></i>
                                </button>
                                <button
                                  onClick={() => handleDelete(expense.id!, group.date)}
                                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                  title="Eliminar gasto"
                                >
                                  <i className="bi bi-trash"></i>
                                </button>
                              </div>
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

      {/* Modal de Edición de Gasto */}
      {editingExpense && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-2xl max-w-lg w-full space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <i className="bi bi-pencil-square text-blue-600"></i>
                Editar Gasto
              </h3>
              <button
                onClick={() => setEditingExpense(null)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-all"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Concepto / Detalle</label>
                <input
                  list="expense-concepts-edit"
                  type="text"
                  required
                  value={editingExpense.concept}
                  onChange={e => setEditingExpense({ ...editingExpense, concept: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium"
                />
                <datalist id="expense-concepts-edit">
                  {expenseConcepts.map((concept, i) => (
                    <option key={i} value={concept} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Monto ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={editingExpense.amount}
                    onChange={e => setEditingExpense({ ...editingExpense, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Fecha</label>
                  <input
                    type="date"
                    required
                    value={editingExpense.date}
                    onChange={e => setEditingExpense({ ...editingExpense, date: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Método de Pago</label>
                  <select
                    value={editingExpense.paymentMethod || 'cash'}
                    onChange={e => setEditingExpense({ ...editingExpense, paymentMethod: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium"
                  >
                    <option value="cash">Efectivo</option>
                    <option value="transfer">Transferencia</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Estado de Pago</label>
                  <select
                    value={editingExpense.paymentStatus || 'paid'}
                    onChange={e => setEditingExpense({ ...editingExpense, paymentStatus: e.target.value as any })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium"
                  >
                    <option value="paid">Pagado</option>
                    <option value="pending">Pendiente</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingExpense(null)}
                  className="px-4 py-2 rounded-xl font-bold text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2 rounded-xl font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-md shadow-blue-200 disabled:opacity-50 flex items-center gap-2"
                >
                  {savingEdit && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>}
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
