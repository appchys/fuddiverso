import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, orderBy, limit, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap';

export interface CheckoutSession {
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

interface LiveCheckoutsPanelProps {
    businessId: string;
    orders?: any[];
    onCountChange?: (count: number) => void;
    onOpenManualOrder?: (session: CheckoutSession) => void;
}

export function LiveCheckoutsPanel({ businessId, orders = [], onCountChange, onOpenManualOrder }: LiveCheckoutsPanelProps) {
    const [rawCheckouts, setRawCheckouts] = useState<CheckoutSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [isExpanded, setIsExpanded] = useState(true);

    // Fetch raw data from Firestore
    useEffect(() => {
        if (businessId === undefined) return;

        const activeSince = Timestamp.fromDate(new Date(Date.now() - 30 * 60 * 1000));
        const q = businessId && businessId !== "" 
            ? query(
                collection(db, 'checkoutProgress'),
                where('businessId', '==', businessId),
                orderBy('updatedAt', 'desc'),
                limit(50)
            )
            : query(
                collection(db, 'checkoutProgress'),
                where('updatedAt', '>=', activeSince),
                orderBy('updatedAt', 'desc'),
                limit(50)
            );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const activeCheckouts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as CheckoutSession[];

            const now = new Date();
            const filtered = activeCheckouts.filter(c => {
                if (c.currentStep < 1) return false;
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
        <div className="bg-white rounded-xl shadow-sm border border-blue-100/80 mb-6 overflow-hidden transition-all">
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-3 flex justify-between items-center bg-gradient-to-r from-blue-50/80 to-indigo-50/50 hover:from-blue-100/70 hover:to-indigo-100/60 transition-colors text-left"
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="relative flex h-3 w-3 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-600 shadow-sm shadow-blue-300"></span>
                    </span>
                    <h3 className="font-black text-gray-900 text-sm sm:text-base tracking-tight truncate">
                        Clientes comprando ahora
                    </h3>
                    <span className="shrink-0 bg-blue-600 text-white text-xs font-black px-2 py-0.5 rounded-full shadow-xs">
                        {checkouts.length}
                    </span>
                </div>
                <div className="shrink-0 ml-2 text-gray-500 hover:text-gray-700">
                    <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-sm transition-transform duration-200`}></i>
                </div>
            </button>

            {isExpanded && (
                <div className="p-3 sm:p-4 space-y-3 bg-gray-50/40 border-t border-blue-100/60 animate-in slide-in-from-top-2 duration-200">
                    {checkouts.map(session => (
                        <CheckoutSessionCard key={session.id} session={session} onOpenManualOrder={onOpenManualOrder} />
                    ))}
                </div>
            )}
        </div>
    );
}

function getStepLabel(step: number): string {
    if (step <= 1) return 'Paso 1/3 (Datos)';
    if (step === 2) return 'Paso 2/3 (Entrega)';
    return 'Paso 3/3 (Pago)';
}

function getDeliveryCoordinates(latlong?: string): { lat: number; lng: number } | null {
    if (!latlong || latlong.startsWith('pluscode:')) return null;
    const parts = latlong.split(',');
    if (parts.length < 2) return null;
    const lat = Number(parts[0].trim());
    const lng = Number(parts[1].trim());
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng };
}

function cleanDeliveryReferences(references?: string): string | null {
    if (!references) return null;
    const trimmed = references.trim();
    if (/ubicaci[oó]n\s+actual\s*(--|-|–)?\s*coordenadas?/i.test(trimmed)) {
        return null;
    }
    if (/^ubicaci[oó]n\s+actual$/i.test(trimmed)) {
        return null;
    }
    return trimmed;
}

function CheckoutSessionCard({ session, onOpenManualOrder }: { session: CheckoutSession; onOpenManualOrder?: (session: CheckoutSession) => void }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [mapExpanded, setMapExpanded] = useState(false);

    const lastUpdate = session.updatedAt?.toDate ? session.updatedAt.toDate() : new Date(session.updatedAt);
    const timeAgo = formatDistanceToNow(lastUpdate, { addSuffix: true, locale: es });

    const handleCompleteCheckout = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onOpenManualOrder) {
            onOpenManualOrder(session);
        } else {
            alert('Por favor, complete la información faltante en el formulario de orden manual');
        }
    };

    const cleanPhone = (session.customerData?.phone || '').replace(/\D/g, '');
    const isPickup = session.deliveryData?.type === 'pickup';
    const totalEst = (session.cartItems?.reduce((acc, item) => acc + ((item.price || item.product?.price || 0) * item.quantity), 0) || 0) + (parseFloat(session.deliveryData?.tarifa || '0') || 0);

    const deliveryCoordinates = getDeliveryCoordinates(session.deliveryData?.latlong);
    const displayReferences = cleanDeliveryReferences(session.deliveryData?.references);
    const deliveryMapsUrl = deliveryCoordinates
        ? `https://www.google.com/maps/search/?api=1&query=${deliveryCoordinates.lat},${deliveryCoordinates.lng}`
        : undefined;
    const deliveryMapImageUrl = deliveryCoordinates
        ? `https://maps.googleapis.com/maps/api/staticmap?center=${deliveryCoordinates.lat},${deliveryCoordinates.lng}&zoom=16&size=600x180&scale=2&maptype=roadmap&markers=color:red%7C${deliveryCoordinates.lat},${deliveryCoordinates.lng}&key=${GOOGLE_MAPS_API_KEY}`
        : undefined;

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200/90 overflow-hidden transition-all hover:border-blue-300 hover:shadow-sm">
            {/* Header: Click to toggle accordion */}
            <div
                className="p-3 sm:p-3.5 bg-white cursor-pointer hover:bg-slate-50/80 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-start justify-between gap-2.5">
                    {/* Left details (with min-w-0 to prevent flex blowout) */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                        {/* Name & Type Badge */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <i className="bi bi-person-fill text-blue-500 shrink-0 text-sm"></i>
                                <span className="text-sm font-black text-gray-900 tracking-tight truncate">
                                    {session.customerData?.name || "Cliente anónimo"}
                                </span>
                            </div>
                            <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                isPickup 
                                    ? 'bg-amber-50 text-amber-700 border-amber-200' 
                                    : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                            }`}>
                                <i className={`bi ${isPickup ? 'bi-shop' : 'bi-bicycle'}`}></i>
                                {isPickup ? 'Retiro' : 'Domicilio'}
                            </span>
                        </div>

                        {/* Status + Time */}
                        <div className="flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
                            <span className="inline-flex items-center gap-1 font-medium">
                                <i className="bi bi-clock text-gray-400"></i>
                                {timeAgo}
                            </span>
                            <span>•</span>
                            <span className="text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded text-[10px] border border-blue-100">
                                {getStepLabel(session.currentStep)}
                            </span>
                        </div>

                        {/* Quick Items Preview */}
                        <div className="space-y-0.5 pt-0.5">
                            {session.cartItems?.slice(0, 2).map((item, idx) => {
                                const variant = item.variant || item.variantName;
                                return (
                                    <div key={idx} className="text-[11px] leading-tight text-gray-600 truncate flex items-center gap-1">
                                        <span className="font-bold text-gray-800 shrink-0">{item.quantity}x</span>
                                        <span className="truncate">{item.name}{variant ? ` (${variant})` : ''}</span>
                                    </div>
                                );
                            })}
                            {session.cartItems?.length > 2 && (
                                <div className="text-[10px] text-blue-600 font-medium">
                                    + {session.cartItems.length - 2} productos más...
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right action button & toggle chevron (shrink-0 ensures it never gets squeezed or pushed off) */}
                    <div className="shrink-0 flex flex-col items-end gap-2">
                        <button
                            type="button"
                            onClick={handleCompleteCheckout}
                            className="inline-flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all shadow-xs shrink-0 whitespace-nowrap"
                            title="Completar información en formulario de orden manual"
                        >
                            <i className="bi bi-pencil-square text-xs"></i>
                            <span>Completar</span>
                        </button>
                        <span className="text-gray-400 text-xs flex items-center gap-1 pr-1 font-medium">
                            <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} transition-transform duration-200`}></i>
                        </span>
                    </div>
                </div>
            </div>

            {/* Expanded Body */}
            {isExpanded && (
                <div className="p-3.5 sm:p-4 bg-slate-50/70 border-t border-gray-100 text-xs space-y-3.5 animate-in slide-in-from-top-2 duration-200">
                    {/* Customer Contact & Delivery Info */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {/* Customer Info */}
                        <div className="bg-white p-2.5 rounded-lg border border-gray-200/80 space-y-1.5">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cliente</p>
                            <div className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                                <i className="bi bi-person text-gray-400"></i>
                                {session.customerData?.name || "Sin nombre"}
                            </div>
                            {session.customerData?.phone ? (
                                <div className="flex items-center gap-2 pt-0.5">
                                    <a
                                        href={`https://wa.me/${cleanPhone}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded transition-colors"
                                    >
                                        <i className="bi bi-whatsapp"></i>
                                        {session.customerData.phone}
                                    </a>
                                </div>
                            ) : (
                                <span className="text-gray-400 italic text-[11px]">Sin teléfono</span>
                            )}
                        </div>

                        {/* Delivery & Payment Info */}
                        <div className="bg-white p-2.5 rounded-lg border border-gray-200/80 space-y-2">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Entrega y Pago</p>
                            
                            <div className="space-y-1.5">
                                {!isPickup && deliveryCoordinates && deliveryMapImageUrl && deliveryMapsUrl ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setMapExpanded(!mapExpanded);
                                            }}
                                            className="group flex w-full max-w-full items-start justify-between gap-1.5 rounded-lg p-1.5 text-left text-xs text-gray-700 transition-colors hover:bg-red-50/70 hover:text-red-700 -m-1"
                                            title={mapExpanded ? 'Ocultar mapa de entrega' : 'Ver mapa de entrega'}
                                            aria-expanded={mapExpanded}
                                        >
                                            <div className="flex items-start gap-1.5 min-w-0 flex-1">
                                                <i className="bi bi-geo-alt-fill text-red-500 mt-0.5 shrink-0 group-hover:scale-110 transition-transform"></i>
                                                <div className="min-w-0 flex-1">
                                                    <span className="line-clamp-2 leading-tight font-medium">
                                                        {session.deliveryData?.address || "Ubicación"}
                                                    </span>
                                                    {displayReferences && (
                                                        <span className="block text-[10px] text-gray-500 italic mt-0.5 group-hover:text-red-600">
                                                            Ref: {displayReferences}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <i className={`bi bi-chevron-${mapExpanded ? 'up' : 'down'} text-[10px] text-gray-400 group-hover:text-red-500 mt-0.5 shrink-0 transition-transform`}></i>
                                        </button>

                                        {mapExpanded && (
                                            <div className="mt-1.5 overflow-hidden rounded-xl border border-red-100 bg-red-50/50 animate-in slide-in-from-top-1 duration-150">
                                                <a
                                                    href={deliveryMapsUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="block relative group/map"
                                                    title="Abrir ubicación en Google Maps"
                                                >
                                                    <img
                                                        src={deliveryMapImageUrl}
                                                        alt="Mapa de entrega"
                                                        className="h-28 w-full object-cover"
                                                        loading="lazy"
                                                    />
                                                    <div className="absolute inset-0 bg-black/0 group-hover/map:bg-black/10 transition-colors flex items-center justify-center">
                                                        <span className="opacity-0 group-hover/map:opacity-100 bg-white/90 text-gray-800 text-[10px] font-bold px-2 py-0.5 rounded shadow-xs transition-opacity">
                                                            Abrir en Maps ↗
                                                        </span>
                                                    </div>
                                                </a>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex items-start gap-1.5 text-gray-700">
                                        <i className="bi bi-geo-alt-fill text-red-500 mt-0.5 shrink-0"></i>
                                        <div className="min-w-0">
                                            <span className="line-clamp-2 leading-tight font-medium">
                                                {session.deliveryData?.address || (isPickup ? "Retiro en local" : "Sin dirección todavía")}
                                            </span>
                                            {displayReferences && (
                                                <span className="block text-[10px] text-gray-500 italic mt-0.5">
                                                    Ref: {displayReferences}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-1.5 text-gray-700 pt-1 border-t border-gray-100">
                                <i className="bi bi-credit-card-2-front text-gray-400 shrink-0"></i>
                                <span className="capitalize font-medium">
                                    {session.paymentData?.method ? (
                                        session.paymentData.method === 'cash' ? 'Efectivo' :
                                        session.paymentData.method === 'transfer' ? 'Transferencia' :
                                        session.paymentData.method === 'mixed' ? 'Pago Mixto' : session.paymentData.method
                                    ) : 'Método de pago pendiente'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Cart Details */}
                    <div className="bg-white p-3 rounded-lg border border-gray-200/80 space-y-2">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Productos en Carrito</p>
                        <div className="divide-y divide-gray-100">
                            {session.cartItems?.map((item: any, idx: number) => {
                                const variant = item.variant || item.variantName;
                                const itemPrice = (item.price || item.product?.price || 0) * item.quantity;
                                return (
                                    <div key={idx} className="py-1.5 flex justify-between items-start gap-2">
                                        <div className="min-w-0">
                                            <div className="text-gray-800 font-medium leading-tight">
                                                <span className="font-bold text-gray-900">{item.quantity}x</span> {item.name}
                                            </div>
                                            {variant && <div className="text-[10px] text-gray-500 mt-0.5">{variant}</div>}
                                        </div>
                                        <span className="font-bold text-gray-900 shrink-0">
                                            ${itemPrice.toFixed(2)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Delivery fee & Total */}
                        <div className="border-t border-gray-200 pt-2 flex justify-between items-center">
                            <span className="text-xs text-gray-500">
                                {isPickup ? 'Retiro en local' : `Envío: $${parseFloat(session.deliveryData?.tarifa || '0').toFixed(2)}`}
                            </span>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold uppercase text-gray-500">Total Est.:</span>
                                <span className="text-sm font-black text-gray-900">${totalEst.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
