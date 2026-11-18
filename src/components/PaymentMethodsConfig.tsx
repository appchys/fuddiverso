"use client"

import React, { useState } from 'react'
import { BankAccount } from '@/types'

export const ECUADORIAN_BANKS = [
    { id: 'Banco Pichincha', name: 'Banco Pichincha', icon: 'bi-bank', color: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
    { id: 'Banco Guayaquil', name: 'Banco Guayaquil', icon: 'bi-bank', color: 'bg-pink-50 text-pink-800 border-pink-200' },
    { id: 'Banco del Pacífico', name: 'Banco del Pacífico', icon: 'bi-bank', color: 'bg-blue-50 text-blue-800 border-blue-200' },
    { id: 'Produbanco', name: 'Produbanco', icon: 'bi-bank', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    { id: 'Banco Bolivariano', name: 'Banco Bolivariano', icon: 'bi-bank', color: 'bg-amber-50 text-amber-800 border-amber-200' },
    { id: 'Banco Internacional', name: 'Banco Internacional', icon: 'bi-bank', color: 'bg-orange-50 text-orange-800 border-orange-200' },
    { id: 'Banco del Austro', name: 'Banco del Austro', icon: 'bi-bank', color: 'bg-red-50 text-red-800 border-red-200' },
    { id: 'Cooperativa JEP', name: 'Cooperativa JEP', icon: 'bi-bank2', color: 'bg-teal-50 text-teal-800 border-teal-200' },
    { id: 'Cooperativa Policía Nacional', name: 'Cooperativa Policía Nacional', icon: 'bi-bank2', color: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
    { id: 'Cooperativa 29 de Octubre', name: 'Cooperativa 29 de Octubre', icon: 'bi-bank2', color: 'bg-purple-50 text-purple-800 border-purple-200' },
    { id: 'Deuna!', name: 'Deuna! (Pichincha)', icon: 'bi-qr-code', color: 'bg-yellow-100 text-yellow-900 border-yellow-300' },
    { id: 'Otro', name: 'Otro banco o cooperativa', icon: 'bi-wallet', color: 'bg-gray-50 text-gray-800 border-gray-200' }
]

export const FUDDI_BANK_ACCOUNTS: BankAccount[] = [
    {
        id: 'pichincha',
        bankName: 'Banco Pichincha',
        accountType: 'Ahorros',
        accountNumber: '2203257517',
        accountHolder: 'Pedro Sánchez León',
        idNumber: '0929057636'
    },
    {
        id: 'pacifico',
        bankName: 'Banco del Pacífico',
        accountType: 'Ahorros',
        accountNumber: '1063889358',
        accountHolder: 'Pedro Sánchez León',
        idNumber: '0929057636'
    },
    {
        id: 'guayaquil',
        bankName: 'Banco Guayaquil',
        accountType: 'Ahorros',
        accountNumber: '0030697477',
        accountHolder: 'Pedro Sánchez León',
        idNumber: '0929057636'
    },
    {
        id: 'produbanco',
        bankName: 'Banco Produbanco',
        accountType: 'Ahorros',
        accountNumber: '20059842774',
        accountHolder: 'Pedro Sánchez León',
        idNumber: '0929057636'
    }
]

interface PaymentMethodsConfigProps {
    acceptsCash: boolean
    onToggleCash: () => void
    acceptsTransfer: boolean
    onToggleTransfer: () => void
    bankAccountMode: 'fuddi' | 'custom'
    onChangeBankAccountMode: (mode: 'fuddi' | 'custom') => void
    bankAccounts: BankAccount[]
    onChangeBankAccounts: (accounts: BankAccount[]) => void
    /** Texto descriptivo para diferenciar el contexto de tienda vs admin */
    storeAccountsLabel?: string
}

/**
 * Componente reutilizable para gestionar métodos de pago (Efectivo / Transferencia)
 * y la configuración de cuentas bancarias de una tienda.
 */
export const PaymentMethodsConfig: React.FC<PaymentMethodsConfigProps> = ({
    acceptsCash,
    onToggleCash,
    acceptsTransfer,
    onToggleTransfer,
    bankAccountMode,
    onChangeBankAccountMode,
    bankAccounts,
    onChangeBankAccounts,
    storeAccountsLabel = 'Cuentas de mi Tienda'
}) => {
    const [isAccountFormOpen, setIsAccountFormOpen] = useState(false)
    const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
    const [accountForm, setAccountForm] = useState({
        bankName: 'Banco Pichincha',
        customBankName: '',
        accountType: 'Ahorros',
        accountNumber: '',
        accountHolder: '',
        idNumber: '',
        notes: ''
    })
    const [accountFormError, setAccountFormError] = useState('')

    const handleOpenAddAccount = () => {
        setEditingAccountId(null)
        setAccountForm({
            bankName: 'Banco Pichincha',
            customBankName: '',
            accountType: 'Ahorros',
            accountNumber: '',
            accountHolder: '',
            idNumber: '',
            notes: ''
        })
        setAccountFormError('')
        setIsAccountFormOpen(true)
    }

    const handleOpenEditAccount = (acc: BankAccount) => {
        const isKnownBank = ECUADORIAN_BANKS.some(b => b.id === acc.bankName)
        setEditingAccountId(acc.id)
        setAccountForm({
            bankName: isKnownBank ? acc.bankName : 'Otro',
            customBankName: isKnownBank ? '' : acc.bankName,
            accountType: acc.accountType || 'Ahorros',
            accountNumber: acc.accountNumber || '',
            accountHolder: acc.accountHolder || '',
            idNumber: acc.idNumber || '',
            notes: acc.notes || ''
        })
        setAccountFormError('')
        setIsAccountFormOpen(true)
    }

    const handleCloseAccountForm = () => {
        setIsAccountFormOpen(false)
        setEditingAccountId(null)
        setAccountFormError('')
    }

    const handleSaveAccountForm = () => {
        const finalBankName = accountForm.bankName === 'Otro'
            ? accountForm.customBankName.trim()
            : accountForm.bankName.trim()

        if (!finalBankName) {
            setAccountFormError('Ingresa el nombre del banco o cooperativa.')
            return
        }
        if (!accountForm.accountNumber.trim()) {
            setAccountFormError('Ingresa el número de cuenta.')
            return
        }
        if (!accountForm.accountHolder.trim()) {
            setAccountFormError('Ingresa el nombre del titular de la cuenta.')
            return
        }

        const newAccountData: BankAccount = {
            id: editingAccountId || `acc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            bankName: finalBankName,
            accountType: accountForm.accountType,
            accountNumber: accountForm.accountNumber.trim(),
            accountHolder: accountForm.accountHolder.trim(),
            idNumber: accountForm.idNumber.trim(),
            notes: accountForm.notes.trim()
        }

        const nextAccounts = editingAccountId
            ? bankAccounts.map(a => a.id === editingAccountId ? newAccountData : a)
            : [...bankAccounts, newAccountData]

        onChangeBankAccounts(nextAccounts)
        handleCloseAccountForm()
    }

    const handleDeleteAccount = (accId: string) => {
        if (!confirm('¿Seguro que deseas eliminar esta cuenta bancaria?')) return
        onChangeBankAccounts(bankAccounts.filter(a => a.id !== accId))
    }

    return (
        <div className="space-y-5 sm:space-y-6 animate-fadeIn">
            {/* Encabezado */}
            <div className="pb-3 border-b border-gray-100 flex items-center gap-2.5 sm:gap-3">
                <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black shrink-0">
                    <i className="bi bi-wallet2 text-xs"></i>
                </span>
                <div>
                    <h3 className="font-black text-gray-900 uppercase tracking-wider text-xs sm:text-sm">
                        Métodos de Pago y Transferencias
                    </h3>
                    <p className="text-[11px] text-gray-500 font-medium leading-tight">
                        Activa los métodos de pago que acepta la tienda. Al activar transferencia podrás configurar las cuentas bancarias.
                    </p>
                </div>
            </div>

            {/* Opciones booleanas: Efectivo | Transferencia */}
            <div className="space-y-2.5">
                <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider">
                    Métodos de Pago Aceptados
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Toggle Efectivo */}
                    <button
                        type="button"
                        role="switch"
                        aria-checked={acceptsCash}
                        onClick={onToggleCash}
                        className={`p-4 rounded-2xl border-2 text-left transition-all flex items-center justify-between gap-3 cursor-pointer ${
                            acceptsCash
                                ? 'border-gray-900 bg-gray-900 text-white shadow-md'
                                : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700'
                        }`}
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 ${
                                acceptsCash ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-600'
                            }`}>
                                <i className="bi bi-cash-coin"></i>
                            </div>
                            <div className="min-w-0">
                                <h4 className="font-black text-xs sm:text-sm tracking-tight leading-tight">
                                    Efectivo
                                </h4>
                                <p className={`text-[11px] font-medium truncate mt-0.5 ${
                                    acceptsCash ? 'text-gray-300' : 'text-gray-500'
                                }`}>
                                    {acceptsCash ? 'Activado' : 'Desactivado'}
                                </p>
                            </div>
                        </div>
                        <div className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 flex items-center ${
                            acceptsCash ? 'bg-emerald-500 justify-end' : 'bg-gray-200 justify-start'
                        }`}>
                            <span className="w-5 h-5 rounded-full bg-white shadow-sm block" />
                        </div>
                    </button>

                    {/* Toggle Transferencia */}
                    <button
                        type="button"
                        role="switch"
                        aria-checked={acceptsTransfer}
                        onClick={onToggleTransfer}
                        className={`p-4 rounded-2xl border-2 text-left transition-all flex items-center justify-between gap-3 cursor-pointer ${
                            acceptsTransfer
                                ? 'border-gray-900 bg-gray-900 text-white shadow-md'
                                : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700'
                        }`}
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 ${
                                acceptsTransfer ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-600'
                            }`}>
                                <i className="bi bi-bank"></i>
                            </div>
                            <div className="min-w-0">
                                <h4 className="font-black text-xs sm:text-sm tracking-tight leading-tight">
                                    Transferencia
                                </h4>
                                <p className={`text-[11px] font-medium truncate mt-0.5 ${
                                    acceptsTransfer ? 'text-gray-300' : 'text-gray-500'
                                }`}>
                                    {acceptsTransfer ? 'Activada' : 'Desactivada'}
                                </p>
                            </div>
                        </div>
                        <div className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 flex items-center ${
                            acceptsTransfer ? 'bg-emerald-500 justify-end' : 'bg-gray-200 justify-start'
                        }`}>
                            <span className="w-5 h-5 rounded-full bg-white shadow-sm block" />
                        </div>
                    </button>
                </div>

                {!acceptsCash && !acceptsTransfer && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2.5 text-amber-800 text-xs font-medium">
                        <i className="bi bi-exclamation-triangle-fill text-amber-500 shrink-0"></i>
                        <span>Activa al menos un método de pago (Efectivo o Transferencia) para que los clientes puedan finalizar sus pedidos.</span>
                    </div>
                )}
            </div>

            {!acceptsTransfer ? (
                <div className="p-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 flex items-center gap-3 text-gray-500">
                    <i className="bi bi-info-circle text-gray-400 text-base shrink-0"></i>
                    <p className="text-[11px] sm:text-xs font-medium leading-relaxed">
                        La opción de <strong className="text-gray-700">Transferencia</strong> está desactivada. Actívala arriba para configurar las cuentas bancarias que se mostrarán a los clientes.
                    </p>
                </div>
            ) : (
                <div className="space-y-5 pt-2 border-t border-gray-100 animate-fadeIn">
                    {/* Selector de Modo: Cuentas de Fuddi vs Cuentas Propias */}
                    <div className="space-y-2">
                        <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider">
                            Origen de las Cuentas Bancarias
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* Opción Fuddi */}
                            <button
                                type="button"
                                onClick={() => onChangeBankAccountMode('fuddi')}
                                className={`p-4 rounded-2xl border-2 text-left transition-all flex flex-col justify-between gap-2.5 relative cursor-pointer ${
                                    bankAccountMode === 'fuddi'
                                        ? 'border-gray-900 bg-gray-900 text-white shadow-md'
                                        : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2 w-full">
                                    <div className="flex items-center gap-2.5">
                                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-base ${
                                            bankAccountMode === 'fuddi' ? 'bg-white/20 text-white' : 'bg-red-50 text-red-600'
                                        }`}>
                                            <i className="bi bi-shield-check"></i>
                                        </div>
                                        <div>
                                            <h4 className="font-black text-xs sm:text-sm tracking-tight leading-tight">
                                                Cuentas de Fuddi
                                            </h4>
                                            <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${
                                                bankAccountMode === 'fuddi' ? 'bg-white/20 text-gray-200' : 'bg-gray-100 text-gray-500'
                                            }`}>
                                                Por defecto
                                            </span>
                                        </div>
                                    </div>
                                    <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 ${
                                        bankAccountMode === 'fuddi' ? 'bg-white text-gray-900' : 'border border-gray-300 text-transparent'
                                    }`}>
                                        <i className="bi bi-check"></i>
                                    </div>
                                </div>
                                <p className={`text-[11px] font-medium leading-relaxed ${
                                    bankAccountMode === 'fuddi' ? 'text-gray-300' : 'text-gray-500'
                                }`}>
                                    Se muestran las cuentas bancarias oficiales de Fuddi (Pichincha, Guayaquil, Pacífico, Produbanco).
                                </p>
                            </button>

                            {/* Opción Cuentas Propias */}
                            <button
                                type="button"
                                onClick={() => onChangeBankAccountMode('custom')}
                                className={`p-4 rounded-2xl border-2 text-left transition-all flex flex-col justify-between gap-2.5 relative cursor-pointer ${
                                    bankAccountMode === 'custom'
                                        ? 'border-gray-900 bg-gray-900 text-white shadow-md'
                                        : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2 w-full">
                                    <div className="flex items-center gap-2.5">
                                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-base ${
                                            bankAccountMode === 'custom' ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-600'
                                        }`}>
                                            <i className="bi bi-shop"></i>
                                        </div>
                                        <div>
                                            <h4 className="font-black text-xs sm:text-sm tracking-tight leading-tight">
                                                {storeAccountsLabel}
                                            </h4>
                                            <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${
                                                bankAccountMode === 'custom' ? 'bg-emerald-400/20 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
                                            }`}>
                                                Personalizado
                                            </span>
                                        </div>
                                    </div>
                                    <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 ${
                                        bankAccountMode === 'custom' ? 'bg-white text-gray-900' : 'border border-gray-300 text-transparent'
                                    }`}>
                                        <i className="bi bi-check"></i>
                                    </div>
                                </div>
                                <p className={`text-[11px] font-medium leading-relaxed ${
                                    bankAccountMode === 'custom' ? 'text-gray-300' : 'text-gray-500'
                                }`}>
                                    Los clientes transferirán directamente a las cuentas bancarias registradas aquí.
                                </p>
                            </button>
                        </div>
                    </div>

                    {/* VISTA CUANDO EL MODO ES FUDDI */}
                    {bankAccountMode === 'fuddi' && (
                        <div className="space-y-4 pt-1 animate-fadeIn">
                            <div className="p-3.5 bg-blue-50/80 border border-blue-200/80 rounded-2xl flex items-start gap-3">
                                <i className="bi bi-info-circle-fill text-blue-600 text-base mt-0.5 shrink-0"></i>
                                <div className="text-[11px] sm:text-xs text-blue-900 font-medium leading-relaxed">
                                    <p className="font-bold mb-0.5">Cuentas activas en el Checkout:</p>
                                    Los clientes verán las cuentas corporativas de Fuddi para realizar la transferencia. Puedes cambiar a &quot;{storeAccountsLabel}&quot; en cualquier momento para usar cuentas propias.
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {FUDDI_BANK_ACCOUNTS.map((account) => {
                                    const bankMeta = ECUADORIAN_BANKS.find(b => b.id === account.bankName)
                                    return (
                                        <div
                                            key={account.id}
                                            className="p-3.5 rounded-2xl border border-gray-200 bg-gray-50/70 space-y-2"
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black ${bankMeta?.color || 'bg-white text-gray-700 border border-gray-200'}`}>
                                                    <i className={`bi ${bankMeta?.icon || 'bi-bank'}`}></i>
                                                </div>
                                                <div>
                                                    <h4 className="font-black text-xs text-gray-900 leading-tight">{account.bankName}</h4>
                                                    <span className="text-[10px] text-gray-400 font-bold uppercase">{account.accountType}</span>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                                                <div>
                                                    <p className="text-[10px] text-gray-400 uppercase font-black">Cuenta</p>
                                                    <p className="font-mono font-bold text-gray-900 text-xs">{account.accountNumber}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-gray-400 uppercase font-black">Titular</p>
                                                    <p className="font-medium text-gray-800 text-xs truncate">{account.accountHolder}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* VISTA CUANDO EL MODO ES PERSONALIZADO (CUENTAS DE LA TIENDA) */}
                    {bankAccountMode === 'custom' && (
                        <div className="space-y-4 pt-1 animate-fadeIn">
                            <div className="flex items-center justify-between pb-1">
                                <div>
                                    <h4 className="font-black text-gray-900 text-xs uppercase tracking-wider">
                                        Cuentas Bancarias Registradas
                                    </h4>
                                    <p className="text-[11px] text-gray-500 font-medium">
                                        Agrega las cuentas a las que los clientes podrán transferir.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleOpenAddAccount}
                                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-black text-white text-xs font-black rounded-xl transition-all shadow-sm active:scale-95 shrink-0"
                                >
                                    <i className="bi bi-plus-lg"></i>
                                    <span>Agregar Cuenta</span>
                                </button>
                            </div>

                            {/* Modal / Formulario para Agregar o Editar Cuenta Propia */}
                            {isAccountFormOpen && (
                                <div className="bg-gray-50/90 border-2 border-gray-900/10 rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-sm space-y-4 animate-fadeIn">
                                    <div className="flex items-center justify-between pb-2 border-b border-gray-200">
                                        <h4 className="font-black text-gray-900 text-xs sm:text-sm uppercase tracking-wider flex items-center gap-2">
                                            <i className="bi bi-bank2 text-red-600"></i>
                                            {editingAccountId ? 'Editar Cuenta Bancaria' : 'Nueva Cuenta Bancaria'}
                                        </h4>
                                        <button
                                            type="button"
                                            onClick={handleCloseAccountForm}
                                            className="w-7 h-7 rounded-full bg-white text-gray-400 hover:text-gray-700 flex items-center justify-center transition-colors"
                                        >
                                            <i className="bi bi-x-lg text-xs"></i>
                                        </button>
                                    </div>

                                    {accountFormError && (
                                        <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs font-semibold flex items-center gap-2">
                                            <i className="bi bi-exclamation-circle-fill"></i>
                                            {accountFormError}
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                        {/* Banco */}
                                        <div>
                                            <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                                                Banco o Cooperativa <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                value={accountForm.bankName}
                                                onChange={(e) => setAccountForm(prev => ({ ...prev, bankName: e.target.value }))}
                                                className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:border-gray-900 transition-colors shadow-sm"
                                            >
                                                {ECUADORIAN_BANKS.map((b) => (
                                                    <option key={b.id} value={b.id}>{b.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Si es "Otro", especificar nombre */}
                                        {accountForm.bankName === 'Otro' ? (
                                            <div>
                                                <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                                                    Nombre de la entidad <span className="text-red-500">*</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    value={accountForm.customBankName}
                                                    onChange={(e) => setAccountForm(prev => ({ ...prev, customBankName: e.target.value }))}
                                                    placeholder="Ej: Banco Solidario, Coop. Jep..."
                                                    className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:border-gray-900 transition-colors shadow-sm"
                                                />
                                            </div>
                                        ) : (
                                            /* Tipo de Cuenta */
                                            <div>
                                                <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                                                    Tipo de cuenta <span className="text-red-500">*</span>
                                                </label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {['Ahorros', 'Corriente'].map((type) => (
                                                        <button
                                                            key={type}
                                                            type="button"
                                                            onClick={() => setAccountForm(prev => ({ ...prev, accountType: type }))}
                                                            className={`py-2 px-3 rounded-xl text-xs font-black transition-all border ${
                                                                accountForm.accountType === type
                                                                    ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                                                                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                                                            }`}
                                                        >
                                                            {type}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Número de cuenta */}
                                        <div>
                                            <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                                                Número de cuenta <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={accountForm.accountNumber}
                                                onChange={(e) => setAccountForm(prev => ({ ...prev, accountNumber: e.target.value.replace(/\s+/g, '') }))}
                                                placeholder="Ej: 2201928471"
                                                className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-mono font-bold text-gray-900 focus:outline-none focus:border-gray-900 transition-colors shadow-sm"
                                            />
                                        </div>

                                        {/* Titular de la cuenta */}
                                        <div>
                                            <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                                                Titular de la cuenta <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={accountForm.accountHolder}
                                                onChange={(e) => setAccountForm(prev => ({ ...prev, accountHolder: e.target.value }))}
                                                placeholder="Nombre y Apellido o Razón Social"
                                                className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:border-gray-900 transition-colors shadow-sm"
                                            />
                                        </div>

                                        {/* Cédula o RUC */}
                                        <div className="sm:col-span-2">
                                            <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                                                Cédula / RUC del titular
                                            </label>
                                            <input
                                                type="text"
                                                value={accountForm.idNumber}
                                                onChange={(e) => setAccountForm(prev => ({ ...prev, idNumber: e.target.value.trim() }))}
                                                placeholder="Ej: 0928374615 ó 0928374615001"
                                                className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-mono font-medium text-gray-900 focus:outline-none focus:border-gray-900 transition-colors shadow-sm"
                                            />
                                        </div>
                                    </div>

                                    {/* Botones del Formulario */}
                                    <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-gray-200">
                                        <button
                                            type="button"
                                            onClick={handleCloseAccountForm}
                                            className="px-4 py-2 bg-white text-gray-600 hover:text-gray-900 text-xs font-bold rounded-xl border border-gray-200 hover:border-gray-300 transition-colors"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSaveAccountForm}
                                            className="px-5 py-2 bg-red-600 hover:bg-black text-white text-xs font-black rounded-xl shadow-md shadow-red-200 transition-all active:scale-95"
                                        >
                                            {editingAccountId ? 'Actualizar Cuenta' : 'Guardar Cuenta'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Lista de Cuentas Bancarias Propias */}
                            {bankAccounts.length === 0 ? (
                                <div className="p-8 text-center bg-gray-50/80 border-2 border-dashed border-gray-200 rounded-3xl space-y-3">
                                    <div className="w-14 h-14 mx-auto rounded-full bg-white shadow-sm flex items-center justify-center text-gray-400 text-2xl">
                                        <i className="bi bi-bank"></i>
                                    </div>
                                    <div>
                                        <h4 className="font-black text-gray-900 text-sm">No hay cuentas propias registradas</h4>
                                        <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
                                            Agrega al menos una cuenta para que los clientes puedan transferir directamente.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleOpenAddAccount}
                                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-black text-white text-xs font-black rounded-xl transition-all shadow-md shadow-red-200"
                                    >
                                        <i className="bi bi-plus-lg"></i>
                                        <span>Registrar cuenta propia</span>
                                    </button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                    {bankAccounts.map((account) => {
                                        const bankMeta = ECUADORIAN_BANKS.find(b => b.id === account.bankName)
                                        return (
                                            <div
                                                key={account.id}
                                                className="p-4 rounded-2xl border-2 border-gray-200 bg-white hover:border-gray-300 transition-all flex flex-col justify-between gap-3 relative overflow-hidden"
                                            >
                                                {/* Cabecera de la tarjeta */}
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base font-black ${bankMeta?.color || 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                                                            <i className={`bi ${bankMeta?.icon || 'bi-bank'}`}></i>
                                                        </div>
                                                        <div>
                                                            <h4 className="font-black text-gray-900 text-sm tracking-tight leading-tight">
                                                                {account.bankName}
                                                            </h4>
                                                            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                                                                Cuenta de {account.accountType}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Datos de la cuenta */}
                                                <div className="space-y-1.5 pt-1">
                                                    <div>
                                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Número de Cuenta</p>
                                                        <p className="font-mono font-bold text-sm text-gray-900 bg-gray-50 px-2 py-0.5 rounded-lg border border-gray-100 inline-block">
                                                            {account.accountNumber}
                                                        </p>
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                                                        <div>
                                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Titular</p>
                                                            <p className="font-bold text-gray-800 truncate" title={account.accountHolder}>
                                                                {account.accountHolder}
                                                            </p>
                                                        </div>
                                                        {account.idNumber && (
                                                            <div>
                                                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cédula / RUC</p>
                                                                <p className="font-medium text-gray-700 font-mono">
                                                                    {account.idNumber}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Acciones de la cuenta */}
                                                <div className="pt-2 border-t border-gray-100 flex items-center justify-end gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenEditAccount(account)}
                                                        className="p-1.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1 font-bold"
                                                        title="Editar datos de cuenta"
                                                    >
                                                        <i className="bi bi-pencil"></i>
                                                        <span className="text-[11px]">Editar</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteAccount(account.id)}
                                                        className="p-1.5 text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Eliminar cuenta"
                                                    >
                                                        <i className="bi bi-trash"></i>
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
