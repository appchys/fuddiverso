import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface CheckoutSession {
    id: string;
    clientId: string;
    businessId: string;
    cartItems: any[];
    customerData: {
        name: string;
        phone: string;
    };
    deliveryData: {
        type: string;
        address: string;
        references: string;
        tarifa: string;
        latlong?: string;
    };
    timingData: {
        type: string;
        scheduledDate?: string;
        scheduledTime?: string;
    };
    paymentData: {
        method: string;
        paymentStatus: string;
        cashAmount?: number;
        transferAmount?: number;
    };
    currentStep: number;
    lastActivityAt: any;
    updatedAt: any;
}

export function LiveCheckoutsPanel({ businessId, orders = [] }: { businessId: string; orders?: any[] }) {
    const [rawCheckouts, setRawCheckouts] = useState<CheckoutSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);

    // Debug logging
    useEffect(() => {
        console.log('[LiveCheckouts] Mounted with businessId:', businessId);
    }, [businessId]);

    // Fetch raw data from Firestore (no order-based filtering here to avoid stale closures)
    useEffect(() => {
        if (!businessId) {
            console.log('[LiveCheckouts] No businessId provided');
            return;
        }

        const q = query(
            collection(db, 'checkoutProgress'),
            where('businessId', '==', businessId),
            orderBy('updatedAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const activeCheckouts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as CheckoutSession[];

            console.log(`[LiveCheckouts] Total raw docs in DB for business:`, activeCheckouts.length);

            // Only apply time-based and step-based filters here
            const now = new Date();
            const filtered = activeCheckouts.filter(c => {
                if (c.currentStep > 3) {
                    console.log(`[LiveCheckouts] Session ${c.id} filtered out: step > 3 (${c.currentStep})`);
                    return false;
                }
                if (!c.updatedAt) {
                    console.log(`[LiveCheckouts] Session ${c.id} filtered out: no updatedAt`);
                    return false;
                }
                const lastUpdate = c.updatedAt?.toDate ? c.updatedAt.toDate() : new Date(c.updatedAt);
                const diffMins = (now.getTime() - lastUpdate.getTime()) / 60000;
                if (diffMins >= 30) {
                    console.log(`[LiveCheckouts] Session ${c.id} filtered out: too old (${diffMins.toFixed(1)} mins)`);
                    return false;
                }
                return true;
            });

            console.log(`[LiveCheckouts] Raw sessions after time/step filter:`, filtered.length);
            setRawCheckouts(filtered);
            setLoading(false);
        }, (error) => {
            console.error('[LiveCheckouts] Snapshot error:', error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [businessId]);

    // Apply order-based filtering reactively (orders prop changes on each new order)
    const checkouts = useMemo(() => {
        if (rawCheckouts.length === 0) return [];
        const orderPhones = new Set(
            orders.map(o => o.customer?.phone).filter(Boolean)
        );

        const final = rawCheckouts.filter(c => {
            const sessionPhone = c.customerData?.phone;
            if (sessionPhone && orderPhones.has(sessionPhone)) {
                console.log(`[LiveCheckouts] Session ${c.id} filtered out: phone exists in today's orders`);
                return false;
            }
            return true;
        });

        console.log(`[LiveCheckouts] Final checkouts to render:`, final.length);
        return final;
    }, [rawCheckouts, orders]);

    if (loading) {
        console.log('[LiveCheckouts] Still loading...');
        return null;
    }

    if (checkouts.length === 0) {
        console.log('[LiveCheckouts] No sessions to show (checkouts.length === 0)');
        return null;
    }

    return (
        <div className="mb-6 bg-white rounded-xl shadow-sm border border-blue-100 overflow-hidden">
            <div
                className="bg-blue-50 px-4 py-3 flex justify-between items-center cursor-pointer hover:bg-blue-100 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <span className="flex h-3 w-3 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                        </span>
                    </div>
                    <h3 className="font-bold text-blue-800">Clientes comprando ahora</h3>
                    <span className="bg-blue-200 text-blue-800 text-xs font-bold px-2 py-0.5 rounded-full">
                        {checkouts.length}
                    </span>
                </div>
                <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-blue-600`}></i>
            </div>

            {isExpanded && (
                <div className="p-4 grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {checkouts.map(session => (
                        <div key={session.id} className="bg-white border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow relative">
                            <div className="absolute top-3 right-3 flex flex-col items-end">
                                <span className="text-[10px] text-gray-400 font-mono">
                                    {session.updatedAt && formatDistanceToNow(session.updatedAt?.toDate ? session.updatedAt.toDate() : new Date(session.updatedAt), { addSuffix: true, locale: es })}
                                </span>
                                <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded mt-1">
                                    Paso {session.currentStep}/3
                                </span>
                            </div>

                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
                                    <i className="bi bi-person-fill text-xl"></i>
                                </div>
                                <div>
                                    <p className="font-bold text-gray-900 text-sm">{session.customerData?.name || 'Cliente anónimo'}</p>
                                    <p className="text-xs text-gray-500">{session.customerData?.phone || 'Sin teléfono'}</p>
                                </div>
                            </div>

                            <div className="space-y-2 mb-3">
                                <div className="flex items-start gap-2 text-xs">
                                    <i className="bi bi-geo-alt text-red-500 mt-0.5"></i>
                                    <span className="text-gray-600 line-clamp-2">
                                        {session.deliveryData?.address
                                            ? `${session.deliveryData.address} (${session.deliveryData.type === 'pickup' ? 'Retiro' : 'Domicilio'})`
                                            : 'Seleccionando ubicación...'}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2 text-xs">
                                    <i className="bi bi-clock text-purple-600"></i>
                                    <span className="text-gray-600">
                                        {session.timingData?.type === 'immediate'
                                            ? 'Lo antes posible'
                                            : (session.timingData?.type === 'scheduled'
                                                ? `Programado: ${session.timingData.scheduledDate} ${session.timingData.scheduledTime}`
                                                : 'Eligiendo horario...')}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2 text-xs">
                                    <i className={`bi ${session.paymentData?.method === 'transfer' ? 'bi-bank text-blue-600' :
                                        session.paymentData?.method === 'cash' ? 'bi-cash text-green-600' :
                                            session.paymentData?.method === 'mixed' ? 'bi-cash-coin text-orange-600' :
                                                'bi-credit-card text-gray-400'}`}></i>
                                    <span className="text-gray-600">
                                        {session.paymentData?.method === 'cash' ? 'Efectivo' :
                                            session.paymentData?.method === 'transfer' ? 'Transferencia' :
                                                session.paymentData?.method === 'mixed' ? 'Mixto' : 'Eligiendo pago...'}
                                    </span>
                                </div>
                            </div>

                            <div className="border-t pt-2 mt-2">
                                <p className="text-xs text-gray-500 mb-2">Carrito ({session.cartItems?.length || 0} items):</p>
                                <div className="space-y-1 mb-2 max-h-[150px] overflow-y-auto custom-scrollbar">
                                    {session.cartItems?.map((item, idx) => (
                                        <div key={idx} className="flex justify-between items-start text-xs bg-gray-50 p-1.5 rounded border border-gray-100">
                                            <div className="flex-1 pr-2">
                                                <span className="font-bold text-gray-700">{item.quantity}x </span>
                                                <span className="text-gray-800">{item.name}</span>
                                                {item.variantName && (
                                                    <div className="text-[10px] text-gray-500 italic pl-4">
                                                        {item.variantName}
                                                    </div>
                                                )}
                                            </div>
                                            <span className="font-mono text-gray-600">
                                                ${((item.price || item.product?.price || 0) * item.quantity).toFixed(2)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-2 text-right pt-2 border-t border-gray-100">
                                    <span className="text-sm font-bold text-gray-900">
                                        Total: ${(session.cartItems?.reduce((acc, item) => acc + ((item.price || item.product?.price || 0) * item.quantity), 0) + (parseFloat(session.deliveryData?.tarifa || '0'))).toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
