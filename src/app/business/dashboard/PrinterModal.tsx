'use client'

import React, { useState } from 'react'
import { Order } from '@/types'
import { formatPrice } from '@/lib/price-utils'
import { toSafeDate } from './dashboard-utils'
import { doc, deleteDoc, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export interface PrintJob {
    id: string
    businessId: string
    order: Order
    businessName?: string
    businessLogo?: string | null
    groupItemsByProduct?: boolean
    status: 'pending' | 'processing' | 'printed' | 'failed'
    createdAt?: any
    processingAt?: any
    printedAt?: any
    failedAt?: any
    retriedAt?: any
    error?: string
    source?: string
    processorId?: string
}

interface PrinterModalProps {
    isOpen: boolean
    onClose: () => void
    businessId?: string | null
    printerStatus: { connected: boolean; deviceName: string | null }
    connectingPrinter: boolean
    printerError: string
    printMode: 'standard' | 'bluetooth'
    onConnect: () => Promise<void>
    onDisconnect: () => void
    onTogglePrintMode: () => void
    onPrintOrder: (order: Order, silent?: boolean) => Promise<void>
    printJobs: PrintJob[]
}

export function PrinterModal({
    isOpen,
    onClose,
    businessId,
    printerStatus,
    connectingPrinter,
    printerError,
    printMode,
    onConnect,
    onDisconnect,
    onTogglePrintMode,
    onPrintOrder,
    printJobs,
}: PrinterModalProps) {
    const [reprintingId, setReprintingId] = useState<string | null>(null)
    if (!isOpen) return null

    // Solo mostrar los que están pendientes de impresión (en espera, imprimiendo o con error)
    const pendingJobs = printJobs.filter(j => j.status !== 'printed')
    const pendingJobsCount = pendingJobs.filter(j => j.status === 'pending' || j.status === 'processing').length
    const failedJobsCount = pendingJobs.filter(j => j.status === 'failed').length

    const handleReprint = async (job: PrintJob) => {
        if (!job.order) return
        setReprintingId(job.id)
        try {
            await onPrintOrder(job.order)
        } catch (e) {
            console.error('Error al reimprimir:', e)
        } finally {
            setReprintingId(null)
        }
    }

    const handleDelete = async (jobId: string, e?: React.MouseEvent) => {
        e?.stopPropagation()
        try {
            await deleteDoc(doc(db, 'printJobs', jobId))
        } catch (error) {
            console.error('Error al eliminar trabajo de impresión:', error)
        }
    }

    const formatJobTime = (timestamp: any) => {
        try {
            const date = toSafeDate(timestamp)
            return date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
        } catch {
            return '--:--'
        }
    }

    return (
        <>
            {/* Backdrop en pantallas móviles */}
            <div 
                className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40 sm:hidden"
                onClick={onClose}
                aria-hidden="true"
            />

            <div
                className={`fixed inset-x-3 top-16 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 w-auto ${pendingJobs.length > 0 ? 'sm:w-[440px]' : 'sm:w-[360px]'} max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 sm:p-5 z-50 flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Encabezado */}
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${printerStatus.connected ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                            <i className="bi bi-printer text-base"></i>
                        </div>
                        <div>
                            <h3 className="font-black text-sm text-gray-900 tracking-tight leading-tight">
                                {pendingJobs.length > 0 ? 'Impresora y Cola' : 'Impresora térmica'}
                            </h3>
                            <p className="text-[11px] font-medium text-gray-500 leading-none mt-0.5">
                                {pendingJobs.length > 0 ? `${pendingJobs.length} ticket${pendingJobs.length > 1 ? 's' : ''} pendiente${pendingJobs.length > 1 ? 's' : ''}` : 'Conexión y modo de impresión'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Cerrar"
                    >
                        <i className="bi bi-x-lg text-xs"></i>
                    </button>
                </div>

                {/* Contenido con scroll vertical */}
                <div className="flex-1 overflow-y-auto space-y-4 pt-3.5 pr-0.5">
                    {/* Sección 1: Conexión y Estado */}
                    <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-100 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className={`w-2.5 h-2.5 rounded-full ${printerStatus.connected ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`}></span>
                                <div>
                                    <p className="text-xs font-bold text-gray-900 leading-tight">
                                        {printerStatus.connected ? (printerStatus.deviceName || 'Conectada por Bluetooth') : 'No conectada'}
                                    </p>
                                    <p className={`text-[11px] font-medium ${printerStatus.connected ? 'text-emerald-600' : 'text-gray-400'}`}>
                                        {printerStatus.connected ? 'Lista para imprimir tickets' : 'Conecta tu impresora térmica'}
                                    </p>
                                </div>
                            </div>

                            {printerStatus.connected ? (
                                <button
                                    onClick={onDisconnect}
                                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-sm"
                                >
                                    Desconectar
                                </button>
                            ) : (
                                <button
                                    onClick={onConnect}
                                    disabled={connectingPrinter}
                                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors shadow-sm shadow-emerald-200"
                                >
                                    {connectingPrinter && <i className="bi bi-arrow-repeat animate-spin text-xs"></i>}
                                    {connectingPrinter ? 'Conectando...' : 'Conectar'}
                                </button>
                            )}
                        </div>

                        {printerError && (
                            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-start gap-1.5">
                                <i className="bi bi-exclamation-circle text-rose-500 mt-0.5"></i>
                                <span className="flex-1 leading-snug">{printerError}</span>
                            </div>
                        )}

                        {/* Selector de modo */}
                        <div className="pt-2 border-t border-gray-200/60">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Modo de impresión</p>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => printMode === 'bluetooth' && onTogglePrintMode()}
                                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-all ${
                                        printMode === 'standard'
                                            ? 'border-rose-300 bg-white text-rose-700 shadow-sm ring-1 ring-rose-200'
                                            : 'border-transparent text-gray-500 hover:bg-gray-200/60'
                                    }`}
                                >
                                    <i className="bi bi-file-earmark-pdf"></i>
                                    PDF
                                </button>
                                <button
                                    type="button"
                                    onClick={() => printMode === 'standard' && onTogglePrintMode()}
                                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-all ${
                                        printMode === 'bluetooth'
                                            ? 'border-blue-300 bg-white text-blue-700 shadow-sm ring-1 ring-blue-200'
                                            : 'border-transparent text-gray-500 hover:bg-gray-200/60'
                                    }`}
                                >
                                    <i className="bi bi-bluetooth"></i>
                                    Bluetooth
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Sección 2: Cola de Impresión ("abajo" - solo se muestra si no está vacía) */}
                    {pendingJobs.length > 0 && (
                        <div className="pt-2 border-t border-gray-100">
                            <div className="flex items-center justify-between mb-2 px-0.5">
                                <div className="flex items-center gap-2">
                                    <h4 className="font-black text-xs text-gray-900 tracking-tight uppercase">
                                        Cola de Impresión
                                    </h4>
                                    {pendingJobsCount > 0 ? (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 animate-pulse">
                                            {pendingJobsCount} pendiente{pendingJobsCount > 1 ? 's' : ''}
                                        </span>
                                    ) : (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                                            {failedJobsCount} con error
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Lista de trabajos pendientes */}
                            <div className="space-y-2 max-h-64 sm:max-h-72 overflow-y-auto pr-1">
                                {pendingJobs.map((job) => {
                                    const isRetrying = reprintingId === job.id
                                    const itemCount = job.order?.items?.length || 0
                                    const orderTotal = job.order?.total || 0

                                    return (
                                        <div
                                            key={job.id}
                                            className={`p-2.5 rounded-xl border transition-all ${
                                                job.status === 'failed'
                                                    ? 'bg-rose-50/40 border-rose-200'
                                                    : job.status === 'processing'
                                                    ? 'bg-blue-50/30 border-blue-200 ring-1 ring-blue-100'
                                                    : job.status === 'pending'
                                                    ? 'bg-amber-50/30 border-amber-200'
                                                    : 'bg-white border-gray-100 hover:border-gray-200 shadow-sm'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                {/* Identificador y hora */}
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="font-black text-xs text-gray-900 tracking-tight">
                                                        #{(job.order as any)?.orderNumber || job.order?.id?.slice(0, 6) || '---'}
                                                    </span>
                                                    <span className="text-[10px] font-medium text-gray-400">
                                                        {formatJobTime(job.createdAt)}
                                                    </span>
                                                </div>

                                                {/* Badge de estado */}
                                                <div>
                                                    {job.status === 'pending' && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                                            <i className="bi bi-clock"></i>
                                                            En espera
                                                        </span>
                                                    )}
                                                    {job.status === 'processing' && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                                            <i className="bi bi-arrow-repeat animate-spin"></i>
                                                            Imprimiendo
                                                        </span>
                                                    )}
                                                    {job.status === 'printed' && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                            <i className="bi bi-check2"></i>
                                                            Impreso
                                                        </span>
                                                    )}
                                                    {job.status === 'failed' && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                                            <i className="bi bi-exclamation-triangle"></i>
                                                            Error
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Info cliente y detalles */}
                                            <div className="flex items-center justify-between mt-1 text-[11px]">
                                                <p className="font-bold text-gray-800 truncate mr-2 max-w-[200px]">
                                                    {job.order?.customer?.name || 'Cliente sin nombre'}
                                                </p>
                                                <p className="font-medium text-gray-500 whitespace-nowrap">
                                                    {itemCount} {itemCount === 1 ? 'prod.' : 'prods.'} • {formatPrice(orderTotal)}
                                                </p>
                                            </div>

                                            {/* Mensaje de error si falló */}
                                            {job.status === 'failed' && job.error && (
                                                <p className="text-[10px] font-medium text-rose-600 mt-1 truncate" title={job.error}>
                                                    <i className="bi bi-info-circle mr-1"></i>
                                                    {job.error}
                                                </p>
                                            )}

                                            {/* Acciones de la fila */}
                                            <div className="flex items-center justify-end gap-1.5 mt-2 pt-1.5 border-t border-gray-100">
                                                <button
                                                    onClick={() => handleReprint(job)}
                                                    disabled={isRetrying}
                                                    className="px-2.5 py-1 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 text-[11px] font-bold flex items-center gap-1.5 transition-colors border border-gray-200/70"
                                                    title={job.status === 'failed' ? 'Reintentar impresión' : 'Reimprimir ticket'}
                                                >
                                                    <i className={isRetrying ? 'bi bi-arrow-repeat animate-spin' : (job.status === 'failed' ? 'bi bi-arrow-counterclockwise' : 'bi bi-printer')}></i>
                                                    <span>{job.status === 'failed' ? 'Reintentar' : 'Reimprimir'}</span>
                                                </button>

                                                <button
                                                    onClick={(e) => handleDelete(job.id, e)}
                                                    className="p-1 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                                    title="Eliminar de la cola"
                                                >
                                                    <i className="bi bi-trash text-xs"></i>
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}
