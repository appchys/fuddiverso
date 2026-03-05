import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
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

export function LiveCheckoutsPanel({ businessId, orders = [], onCountChange }: { businessId: string; orders?: any[]; onCountChange?: (count: number) => void }) {
    const [rawCheckouts, setRawCheckouts] = useState<CheckoutSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [isExpanded, setIsExpanded] = useState(true);

    // Fetch raw data from Firestore
    useEffect(() => {
        if (!businessId) return;

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

            const now = new Date();
            const filtered = activeCheckouts.filter(c => {
                if (c.currentStep > 3) return false;
                if (!c.updatedAt) return false;
                const lastUpdate = c.updatedAt?.toDate ? c.updatedAt.toDate() : new Date(c.updatedAt);
                const diffMins = (now.getTime() - lastUpdate.getTime()) / 60000;
                return diffMins < 30;
            });

            setRawCheckouts(filtered);
            setLoading(false);
        }, (error) => {
            console.error('[LiveCheckouts] Snapshot error:', error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [businessId]);

    const checkouts = useMemo(() => {
        if (rawCheckouts.length === 0) return [];
        const orderPhones = new Set(
            orders.map(o => o.customer?.phone).filter(Boolean)
        );

        return rawCheckouts.filter(c => {
            const sessionPhone = c.customerData?.phone;
            return !(sessionPhone && orderPhones.has(sessionPhone));
        });
    }, [rawCheckouts, orders]);

    // Notify parent of count changes
    useEffect(() => {
        onCountChange?.(checkouts.length);
    }, [checkouts.length, onCountChange]);

    if (loading || checkouts.length === 0) return null;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6 overflow-hidden">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-3 flex justify-between items-center bg-blue-50/50 hover:bg-blue-100 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500 shadow-sm shadow-blue-200"></span>
                    </span>
                    <h3 className="font-bold text-gray-800 text-lg">Clientes comprando ahora</h3>
                    <span className="bg-white border border-blue-200 text-blue-600 text-xs font-bold px-2.5 py-0.5 rounded-full">{checkouts.length}</span>
                </div>
                <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 transition-transform duration-200`}></i>
            </button>

            {isExpanded && (
                <div className="p-4 space-y-4 bg-gray-50/30 border-t border-gray-100 animate-in slide-in-from-top-2 duration-200">
                    {checkouts.map(session => (
                        <CheckoutSessionCard key={session.id} session={session} />
                    ))}
                </div>
            )}
        </div>
    );
}

function CheckoutSessionCard({ session }: { session: CheckoutSession }) {
    const [isExpanded, setIsExpanded] = useState(false);

    const lastUpdate = session.updatedAt?.toDate ? session.updatedAt.toDate() : new Date(session.updatedAt);
    const timeAgo = formatDistanceToNow(lastUpdate, { addSuffix: true, locale: es });

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden transition-all hover:border-blue-200">
            {/* Header: Name & Step */}
            <div
                className="px-4 py-3 border-b border-gray-50 flex justify-between items-start bg-white cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                        <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 text-xs mr-2 transform transition-transform duration-200`}></i>
                        <span className="text-sm font-bold text-gray-900 flex items-center gap-2">
                            <i className="bi bi-person-fill text-blue-400"></i>
                            {session.customerData?.name || "Cliente anónimo"}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1 ml-5">
                        <i className="bi bi-clock text-gray-400"></i>
                        <span className="text-[11px] font-medium text-gray-500">
                            {timeAgo} • <span className="text-blue-600 font-bold">Paso {session.currentStep}/3</span>
                        </span>
                    </div>

                    {/* Quick Items Preview */}
                    <div className="flex flex-col gap-0.5 mt-1 ml-5">
                        {session.cartItems?.slice(0, 2).map((item, idx) => (
                            <div key={idx} className="text-[10px] leading-tight text-gray-600 truncate">
                                {item.quantity}x {item.name}
                            </div>
                        ))}
                        {session.cartItems?.length > 2 && (
                            <div className="text-[9px] text-gray-400 italic">
                                + {session.cartItems.length - 2} más...
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                    <div className="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-100 capitalize">
                        {session.deliveryData?.type === 'pickup' ? 'Retiro' : 'Domicilio'}
                    </div>
                </div>
            </div>

            {/* Body */}
            {isExpanded && (
                <div className="p-4 bg-white animate-in slide-in-from-top-2 duration-200">
                    {/* Location & Details */}
                    <div className="space-y-2 mb-4">
                        <div className="flex items-start gap-2 text-xs">
                            <i className="bi bi-geo-alt text-red-500 mt-0.5"></i>
                            <span className="text-gray-600 line-clamp-2">
                                {session.deliveryData?.address || "Sin dirección todavía"}
                                {session.deliveryData?.references && <span className="block text-[10px] text-gray-400 italic">{session.deliveryData.references}</span>}
                            </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs">
                            <i className="bi bi-wallet2 text-gray-400"></i>
                            <span className="text-gray-600 capitalize">
                                {session.paymentData?.method ? (
                                    session.paymentData.method === 'cash' ? 'Efectivo' :
                                        session.paymentData.method === 'transfer' ? 'Transferencia' :
                                            session.paymentData.method === 'mixed' ? 'Pago Mixto' : session.paymentData.method
                                ) : 'Método de pago pendiente'}
                            </span>
                        </div>
                    </div>

                    {/* Items List */}
                    <div className="space-y-2 mb-4">
                        <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Carrito</p>
                        {session.cartItems?.map((item: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-sm">
                                <span className="text-gray-700">
                                    <span className="font-medium text-gray-900">{item.quantity}x</span> {item.name}
                                    {item.variantName && <span className="text-[10px] text-gray-400 block ml-4">{item.variantName}</span>}
                                </span>
                                <span className="text-gray-500">${((item.price || item.product?.price || 0) * item.quantity).toFixed(2)}</span>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-dashed border-gray-200 my-3"></div>

                    {/* Total */}
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] bg-gray-100 text-gray-600 font-bold px-2 py-0.5 rounded uppercase tracking-wider">Total Est.</span>
                            <span className="text-sm font-bold text-gray-900">
                                ${(session.cartItems?.reduce((acc, item) => acc + ((item.price || item.product?.price || 0) * item.quantity), 0) + (parseFloat(session.deliveryData?.tarifa || '0'))).toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
