import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, where, onSnapshot, orderBy, limit, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap';
import type { PendingWhatsAppConversation } from '@/components/WhatsAppPendingModal';
import { searchClientByPhone, getClientLocations, createClient, type ClientLocation } from '@/lib/database';
import { ClientLocationsModal } from '@/components/ClientLocationsModal';
import type { Business, Product } from '@/types';
import { getManualOrderStorePrice, getPriceMetadata } from '@/lib/price-utils';
import { getLastStoreCloseMillis } from '@/lib/store-utils';
import { Motorbike } from 'lucide-react';

export interface WhatsAppPreorderDraftItem {
    productId: string;
    name: string;
    productName?: string;
    variant?: string;
    variantName?: string;
    price: number;
    quantity: number;
    image?: string;
    basePrice?: number;
    commission?: number;
    commissionType?: string;
    storeReceives?: number;
    ingredients?: any[];
}

export interface WhatsAppPreorderDraft {
    items?: WhatsAppPreorderDraftItem[];
    timingType?: '' | 'immediate' | 'scheduled';
    scheduledDate?: string;
    scheduledTime?: string;
    deliveryType?: '' | 'delivery' | 'pickup';
    selectedLocation?: ClientLocation | null;
    customLocationInput?: string;
    paymentMethod?: '' | 'cash' | 'transfer' | 'mixed';
    cashAmount?: number;
    transferAmount?: number;
}

interface ResolvedWhatsAppClientProfile {
    clientId?: string;
    clientName?: string;
    clientPhone?: string;
    clientEmail?: string;
    clientNotes?: string;
    isRegistered: boolean;
    locations: ClientLocation[];
}

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
        selectedBank?: string;
        paymentStatus: string;
        receiptImageUrl?: string;
        cashAmount?: number;
        transferAmount?: number;
    };
    currentStep: number;
    lastActivityAt: any;
    updatedAt: any;
    updatedAtMillis?: number;
    status?: 'active' | 'abandoned' | 'closed' | 'completed';
    closedAtMillis?: number;
}

interface LiveCheckoutsPanelProps {
    businessId: string;
    business?: Business | null;
    orders?: any[];
    activeOrders?: any[];
    products?: Product[];
    onCountChange?: (count: number) => void;
    onOpenManualOrder?: (session: CheckoutSession) => void;
    onInspectOrder?: (order: any) => void;
    whatsappPendingCount?: number;
    whatsappConversations?: PendingWhatsAppConversation[];
    onOpenWhatsApp?: () => void;
    onOpenWhatsAppChat?: (
        conv: PendingWhatsAppConversation,
        initialTab?: PreorderTabKey,
        resolvedProfile?: ResolvedWhatsAppClientProfile,
        activeOrder?: any
    ) => void;
    onSelectWhatsAppConversation?: (conv: PendingWhatsAppConversation, draft?: WhatsAppPreorderDraft) => void;
    onCloseWhatsAppConversation?: (docId: string) => void;
    isVisible?: boolean | null;
}

export function LiveCheckoutsPanel({
    businessId,
    business = null,
    orders = [],
    activeOrders = [],
    products = [],
    onCountChange,
    onOpenManualOrder,
    onInspectOrder,
    whatsappPendingCount = 0,
    whatsappConversations = [],
    onOpenWhatsApp,
    onOpenWhatsAppChat,
    onSelectWhatsAppConversation,
    onCloseWhatsAppConversation,
    isVisible = null,
}: LiveCheckoutsPanelProps) {
    const [rawCheckouts, setRawCheckouts] = useState<CheckoutSession[]>([]);
    const [rawCheckoutsFromServer, setRawCheckoutsFromServer] = useState(false);
    const [dismissedCheckoutIds, setDismissedCheckoutIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [isExpanded, setIsExpanded] = useState(true);
    const [nowMillis, setNowMillis] = useState<number>(() => Date.now());
    const autoClosedCheckoutIdsRef = useRef<Set<string>>(new Set());
    const autoClosedWhatsAppIdsRef = useRef<Set<string>>(new Set());

    // Reloj reactivo cada 30s para detectar el instante exacto de cierre de la tienda
    useEffect(() => {
        const interval = setInterval(() => {
            setNowMillis(Date.now());
        }, 30_000);
        return () => clearInterval(interval);
    }, []);

    const lastStoreCloseMillis = useMemo(
        () => getLastStoreCloseMillis(business, new Date(nowMillis)),
        [business, nowMillis]
    );

    const handleCloseCheckout = async (session: CheckoutSession, linkedConv?: PendingWhatsAppConversation) => {
        setDismissedCheckoutIds(prev => {
            const next = new Set(prev);
            next.add(session.id);
            return next;
        });
        try {
            await updateDoc(doc(db, 'checkoutProgress', session.id), {
                status: 'closed',
                closedAtMillis: Date.now(),
            });
        } catch (err: any) {
            if (err?.code !== 'not-found') {
                console.error('[LiveCheckouts] Error closing checkout session:', err);
            }
        }
        if (linkedConv && onCloseWhatsAppConversation) {
            onCloseWhatsAppConversation(linkedConv.docId);
        }
    };

    // Fetch raw data from Firestore (sin límite de 30 minutos; se limpian a la hora de cierre de la tienda)
    useEffect(() => {
        if (businessId === undefined) return;

        const q = businessId && businessId !== "" 
            ? query(
                collection(db, 'checkoutProgress'),
                where('businessId', '==', businessId),
                orderBy('updatedAt', 'desc'),
                limit(50)
            )
            : query(
                collection(db, 'checkoutProgress'),
                orderBy('updatedAt', 'desc'),
                limit(50)
            );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const activeCheckouts = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data({ serverTimestamps: 'estimate' })
            })) as CheckoutSession[];

            const filtered = activeCheckouts.filter(
                c => c.currentStep >= 1 && (!c.status || c.status === 'active')
            );

            setRawCheckouts(filtered);
            setRawCheckoutsFromServer(!snapshot.metadata.fromCache);
            setLoading(false);
        }, (error) => {
            console.error('[LiveCheckouts] Snapshot error:', error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [businessId]);

    // Auto-cerrar en Firestore todos los checkouts y mensajes de WhatsApp anteriores al último cierre de la tienda
    useEffect(() => {
        if (lastStoreCloseMillis === null) return;

        if (rawCheckoutsFromServer) {
            const expiredCheckouts = rawCheckouts.filter(c => {
                if (autoClosedCheckoutIdsRef.current.has(c.id)) return false;
                return getSessionUpdatedDate(c).getTime() <= lastStoreCloseMillis;
            });

            if (expiredCheckouts.length > 0) {
                expiredCheckouts.forEach(c => {
                    autoClosedCheckoutIdsRef.current.add(c.id);
                    updateDoc(doc(db, 'checkoutProgress', c.id), {
                        status: 'abandoned',
                        closedAtMillis: lastStoreCloseMillis,
                    }).catch((err: any) => {
                        if (err?.code === 'not-found') {
                            // El documento ya fue eliminado en el servidor; no reintentar
                            return;
                        }
                        autoClosedCheckoutIdsRef.current.delete(c.id);
                        console.error('[LiveCheckouts] Error auto-closing expired checkout:', err);
                    });
                });
                setDismissedCheckoutIds(prev => {
                    const next = new Set(prev);
                    expiredCheckouts.forEach(c => next.add(c.id));
                    return next;
                });
            }
        }

        if (onCloseWhatsAppConversation) {
            const expiredWhatsApp = whatsappConversations.filter(c => {
                if ((c.status || 'pending') !== 'pending') return false;
                if (!c.docId || autoClosedWhatsAppIdsRef.current.has(c.docId)) return false;
                const effectiveTs = Math.max(c.timestampMillis || 0, c.reopenedAtMillis || 0);
                return effectiveTs > 0 && effectiveTs <= lastStoreCloseMillis;
            });

            expiredWhatsApp.forEach(c => {
                autoClosedWhatsAppIdsRef.current.add(c.docId);
                onCloseWhatsAppConversation(c.docId);
            });
        }
    }, [rawCheckouts, rawCheckoutsFromServer, whatsappConversations, lastStoreCloseMillis, onCloseWhatsAppConversation]);

    const activeOrdersIndex = useMemo(() => {
        const byPhone = new Map<string, any>();
        const byClientId = new Map<string, any>();
        const pool = activeOrders.length > 0 ? activeOrders : orders;
        for (const o of pool) {
            if (!o) continue;
            const st = String(o.status || '').toLowerCase();
            if (st === 'delivered' || st === 'cancelled') continue;
            const phoneKey = normalizePhoneKey(o.customer?.phone);
            if (phoneKey && !byPhone.has(phoneKey)) {
                byPhone.set(phoneKey, o);
            }
            const clientId = String(o.customer?.id || '').trim();
            if (clientId && !byClientId.has(clientId)) {
                byClientId.set(clientId, o);
            }
        }
        return { byPhone, byClientId };
    }, [activeOrders, orders]);

    const findActiveOrderForClient = (phone?: string, clientId?: string) => {
        const cid = (clientId || '').trim();
        if (cid && activeOrdersIndex.byClientId.has(cid)) {
            return activeOrdersIndex.byClientId.get(cid);
        }
        const pKey = normalizePhoneKey(phone);
        if (pKey && activeOrdersIndex.byPhone.has(pKey)) {
            return activeOrdersIndex.byPhone.get(pKey);
        }
        return undefined;
    };

    const checkouts = useMemo(() => {
        if (rawCheckouts.length === 0) return [];
        const orderPhones = new Set(
            orders.map(o => o.customer?.phone).filter(Boolean)
        );

        return rawCheckouts.filter(c => {
            if (dismissedCheckoutIds.has(c.id)) return false;
            if (lastStoreCloseMillis !== null && getSessionUpdatedDate(c).getTime() <= lastStoreCloseMillis) {
                return false;
            }
            const sessionPhone = c.customerData?.phone;
            return !(sessionPhone && orderPhones.has(sessionPhone));
        });
    }, [rawCheckouts, orders, dismissedCheckoutIds, lastStoreCloseMillis]);

    const activeWhatsAppConversations = useMemo(
        () =>
            whatsappConversations.filter(c => {
                if ((c.status || 'pending') !== 'pending') return false;
                if (lastStoreCloseMillis !== null) {
                    const effectiveTs = Math.max(c.timestampMillis || 0, c.reopenedAtMillis || 0);
                    if (effectiveTs > 0 && effectiveTs <= lastStoreCloseMillis) return false;
                }
                return true;
            }),
        [whatsappConversations, lastStoreCloseMillis]
    );

    const [resolvedClientsByConvKey, setResolvedClientsByConvKey] = useState<Record<string, ResolvedWhatsAppClientProfile>>({});
    const resolvingConvKeysRef = useRef<Set<string>>(new Set());

    // Identificar inmediatamente a cada cliente de WhatsApp en nuestra app y pre-cargar sus ubicaciones guardadas
    useEffect(() => {
        if (activeWhatsAppConversations.length === 0) return;

        let cancelled = false;

        activeWhatsAppConversations.forEach((conv) => {
            const convKey = conv.docId || conv.id;
            if (!convKey) return;
            if (resolvedClientsByConvKey[convKey] || resolvingConvKeysRef.current.has(convKey)) return;

            const candidatePhone = (conv.phone || conv.rawPhone || '').trim();
            const existingClientId = (conv.fuddiClientId || '').trim();
            if (!existingClientId && candidatePhone.replace(/\D/g, '').length < 9) return;

            resolvingConvKeysRef.current.add(convKey);

            (async () => {
                try {
                    let clientId = existingClientId;
                    let clientName = (conv.fuddiClientName || '').trim();
                    let clientPhone = candidatePhone;
                    let clientEmail = (conv.fuddiClientEmail || '').trim();
                    let clientNotes = (conv.fuddiClientNotes || '').trim();
                    let isRegistered = Boolean(conv.isRegisteredClient && clientId);

                    if (!clientId && candidatePhone.replace(/\D/g, '').length >= 9) {
                        const found = await searchClientByPhone(candidatePhone);
                        if (found) {
                            clientId = found.id;
                            clientName = (found.nombres || '').trim() || clientName;
                            clientPhone = (found.celular || '').trim() || clientPhone;
                            clientEmail = (found.email || '').trim() || clientEmail;
                            clientNotes = (found.notas || '').trim() || clientNotes;
                            isRegistered = true;

                            // Sincronizar enriquecimiento en Firestore si aún no estaba guardado
                            if (businessId && conv.docId && (!conv.fuddiClientId || !conv.isRegisteredClient)) {
                                updateDoc(doc(db, 'businesses', businessId, 'whatsappPending', conv.docId), {
                                    fuddiClientId: clientId,
                                    fuddiClientName: clientName,
                                    effectiveName: clientName || conv.effectiveName || conv.displayName || '',
                                    fuddiClientEmail: clientEmail,
                                    fuddiClientNotes: clientNotes,
                                    isRegisteredClient: true,
                                }).catch(() => {});
                            }
                        }
                    }

                    const locations = clientId ? await getClientLocations(clientId) : [];

                    if (!cancelled) {
                        setResolvedClientsByConvKey(prev => ({
                            ...prev,
                            [convKey]: {
                                clientId: clientId || undefined,
                                clientName: clientName || undefined,
                                clientPhone: clientPhone || undefined,
                                clientEmail: clientEmail || undefined,
                                clientNotes: clientNotes || undefined,
                                isRegistered,
                                locations,
                            },
                        }));
                    }
                } catch (err) {
                    console.error('[LiveCheckouts] Error resolving WhatsApp client:', err);
                } finally {
                    resolvingConvKeysRef.current.delete(convKey);
                }
            })();
        });

        return () => {
            cancelled = true;
        };
    }, [activeWhatsAppConversations, businessId, resolvedClientsByConvKey]);

    const unifiedEntries = useMemo(() => {
        type UnifiedEntry =
            | {
                kind: 'checkout';
                key: string;
                activityAt: number;
                session: CheckoutSession;
                linkedWhatsApp?: PendingWhatsAppConversation;
            }
            | {
                kind: 'whatsapp';
                key: string;
                activityAt: number;
                conversation: PendingWhatsAppConversation;
            };

        const entries: UnifiedEntry[] = [];
        const matchedConvIds = new Set<string>();

        for (const session of checkouts) {
            const sessionPhoneKey = normalizePhoneKey(session.customerData?.phone);
            const match = activeWhatsAppConversations.find(conv => {
                const convKey = conv.docId || conv.id;
                if (matchedConvIds.has(convKey)) return false;
                if (session.clientId && conv.fuddiClientId && session.clientId === conv.fuddiClientId) {
                    return true;
                }
                const convPhoneKey = normalizePhoneKey(conv.rawPhone || conv.phone);
                return Boolean(sessionPhoneKey && convPhoneKey && sessionPhoneKey === convPhoneKey);
            });

            if (match) {
                matchedConvIds.add(match.docId || match.id);
            }

            const checkoutActivityAt = getSessionUpdatedDate(session).getTime();
            const waActivityAt = match?.timestampMillis || 0;

            entries.push({
                kind: 'checkout',
                key: `checkout:${session.id}`,
                activityAt: Math.max(checkoutActivityAt, waActivityAt),
                session,
                linkedWhatsApp: match,
            });
        }

        for (const conv of activeWhatsAppConversations) {
            const convKey = conv.docId || conv.id;
            if (matchedConvIds.has(convKey)) continue;
            entries.push({
                kind: 'whatsapp',
                key: `wa:${convKey}`,
                activityAt: conv.timestampMillis || 0,
                conversation: conv,
            });
        }

        entries.sort((a, b) => b.activityAt - a.activityAt);
        return entries;
    }, [checkouts, activeWhatsAppConversations]);

    // Notify parent of count changes (unified total)
    useEffect(() => {
        onCountChange?.(unifiedEntries.length);
    }, [unifiedEntries.length, onCountChange]);

    if (isVisible === false) return null;
    const hasWhatsAppActivity = activeWhatsAppConversations.length > 0 || whatsappPendingCount > 0;
    if (isVisible === null && !hasWhatsAppActivity && (loading || checkouts.length === 0)) return null;

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
                    {unifiedEntries.length > 0 && (
                        <span className="shrink-0 bg-blue-600 text-white text-xs font-black px-2 py-0.5 rounded-full shadow-xs">
                            {unifiedEntries.length}
                        </span>
                    )}
                </div>
                <div className="shrink-0 ml-2 text-gray-500 hover:text-gray-700">
                    <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-sm transition-transform duration-200`}></i>
                </div>
            </button>

            {isExpanded && (
                <div className="p-3 sm:p-4 space-y-3 bg-gray-50/40 border-t border-blue-100/60">
                    {unifiedEntries.map(entry =>
                        entry.kind === 'whatsapp' ? (
                            <WhatsAppConversationCard
                                key={entry.key}
                                businessId={businessId}
                                conversation={entry.conversation}
                                resolvedProfile={resolvedClientsByConvKey[entry.conversation.docId || entry.conversation.id]}
                                activeOrder={findActiveOrderForClient(
                                    resolvedClientsByConvKey[entry.conversation.docId || entry.conversation.id]?.clientPhone ||
                                        entry.conversation.phone ||
                                        entry.conversation.rawPhone,
                                    resolvedClientsByConvKey[entry.conversation.docId || entry.conversation.id]?.clientId ||
                                        entry.conversation.fuddiClientId
                                )}
                                onInspectOrder={onInspectOrder}
                                onOpenChatView={onOpenWhatsAppChat}
                                products={products}
                                onSelect={onSelectWhatsAppConversation}
                                onClose={onCloseWhatsAppConversation}
                                onClientRegistered={(profile) => {
                                    const convKey = entry.conversation.docId || entry.conversation.id;
                                    if (!convKey) return;
                                    setResolvedClientsByConvKey(prev => ({
                                        ...prev,
                                        [convKey]: profile,
                                    }));
                                }}
                            />
                        ) : (
                            <CheckoutSessionCard
                                key={entry.key}
                                session={entry.session}
                                onOpenManualOrder={onOpenManualOrder}
                                linkedWhatsApp={entry.linkedWhatsApp}
                                onCloseWhatsApp={onCloseWhatsAppConversation}
                                onCloseCheckout={() => handleCloseCheckout(entry.session, entry.linkedWhatsApp)}
                            />
                        )
                    )}
                    {unifiedEntries.length === 0 && (
                        <p className="text-center text-xs text-gray-500 py-2">
                            No hay clientes comprando ni mensajes de WhatsApp pendientes en este momento.
                        </p>
                    )}
                    {onOpenWhatsApp && (
                        <div className="flex justify-end pt-1">
                            <button
                                type="button"
                                style={{ minHeight: 0 }}
                                onClick={onOpenWhatsApp}
                                className="text-xs font-semibold text-gray-500 hover:text-gray-800 hover:underline transition-colors cursor-pointer bg-transparent border-0 p-0"
                            >
                                Historial
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function getSessionUpdatedDate(session: CheckoutSession): Date {
    if (typeof session.updatedAtMillis === 'number' && session.updatedAtMillis > 0) {
        return new Date(session.updatedAtMillis);
    }
    const raw = session.updatedAt || session.lastActivityAt;
    if (!raw) return new Date();
    if (typeof raw?.toDate === 'function') {
        const d = raw.toDate();
        if (!Number.isNaN(d.getTime())) return d;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizePhoneKey(phone?: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length >= 9 ? digits.slice(-9) : digits;
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

type PreorderTabKey = 'products' | 'timing' | 'delivery' | 'payment';

function normalizeSearchBase(input: string): string {
    return input
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function phoneticSpanish(word: string): string {
    return word
        .replace(/ch/g, 'X')
        .replace(/h/g, '')
        .replace(/X/g, 'ch')
        .replace(/(?:gu|hu|wu|w)/g, 'u')
        .replace(/v/g, 'b')
        .replace(/qu/g, 'k')
        .replace(/c(?=[ei])/g, 's')
        .replace(/c/g, 'k')
        .replace(/z/g, 's')
        .replace(/ll/g, 'y')
        .replace(/([a-z])\1+/g, '$1');
}

function stripSpanishSuffix(word: string): string {
    if (word.length <= 4) return word;
    const stripped = word
        .replace(/(?:sitos|sitas|sito|sita|itos|itas|ito|ita)$/, '')
        .replace(/(?:es|s)$/, '');
    return stripped.length >= 3 ? stripped : word;
}

function levenshteinDistance(a: string, b: string): number {
    if (a === b) return 0;
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    const prev = new Array<number>(n + 1);
    const curr = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= n; j++) prev[j] = curr[j];
    }
    return prev[n];
}

const WHATSAPP_SEARCH_STOPWORDS = new Set([
    'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'dispone', 'disponen',
    'tiene', 'tienen', 'quiero', 'quisiera', 'deseo', 'dame', 'deme', 'regaleme',
    'por', 'favor', 'porfa', 'porfavor', 'para', 'con', 'sin', 'del', 'las', 'los',
    'una', 'uno', 'unos', 'unas', 'que', 'puede', 'puedes', 'pueden', 'enviar',
    'envio', 'mandar', 'mande', 'pedido', 'pedir', 'ayuda', 'ayudeme', 'gracias',
    'cuanto', 'cuesta', 'vale', 'precio', 'hay', 'aun', 'todavia', 'ahora', 'hoy',
]);

function scoreProductSmartMatch(product: Product, rawQuery: string): number {
    const cleanQuery = normalizeSearchBase(rawQuery);
    if (!cleanQuery) return 1;

    const variantNames = (product.variants || []).map(v => v.name || '');
    const fullTextNorm = normalizeSearchBase(
        [product.name, ...variantNames, product.category || '', product.description || ''].join(' ')
    );
    const nameAndVariantsNorm = normalizeSearchBase([product.name, ...variantNames].join(' '));

    // 1. Coincidencia directa de frase completa
    if (nameAndVariantsNorm.includes(cleanQuery)) return 120;
    if (fullTextNorm.includes(cleanQuery)) return 85;

    const rawTokens = cleanQuery.split(' ').filter(Boolean);
    const meaningfulTokens = rawTokens.filter(t => {
        if (/^\d+$/.test(t)) return true;
        return t.length >= 3 && !WHATSAPP_SEARCH_STOPWORDS.has(t);
    });
    const queryTokens = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens.filter(t => t.length >= 2);
    if (queryTokens.length === 0) return 0;

    const primaryWords = nameAndVariantsNorm.split(' ').filter(Boolean);
    const allWords = fullTextNorm.split(' ').filter(Boolean);
    const primaryPhonetic = primaryWords.map(w => ({
        raw: w,
        phon: phoneticSpanish(w),
        stem: stripSpanishSuffix(phoneticSpanish(w)),
    }));
    const secondaryPhonetic = allWords
        .filter(w => !primaryWords.includes(w))
        .map(w => ({
            raw: w,
            phon: phoneticSpanish(w),
            stem: stripSpanishSuffix(phoneticSpanish(w)),
        }));

    let totalScore = 0;
    let matchedWordTokens = 0;

    for (const token of queryTokens) {
        const isNumber = /^\d+$/.test(token);
        if (isNumber) {
            if (primaryWords.includes(token)) {
                totalScore += 22;
            }
            continue;
        }

        const qPhon = phoneticSpanish(token);
        const qStem = stripSpanishSuffix(qPhon);
        let bestTokenScore = 0;

        const evaluateAgainst = (
            candidates: Array<{ raw: string; phon: string; stem: string }>,
            multiplier: number
        ) => {
            for (const c of candidates) {
                let s = 0;
                if (c.raw === token || c.phon === qPhon || c.stem === qStem) {
                    s = 65;
                } else if (
                    (qStem.length >= 3 && (c.phon.includes(qStem) || c.stem.includes(qStem))) ||
                    (c.stem.length >= 3 && (qPhon.includes(c.stem) || qStem.includes(c.stem)))
                ) {
                    s = 52;
                } else if (qStem.length >= 4 && c.stem.length >= 4) {
                    // Comparar raíz fonética con Levenshtein (errores de tipeo / pronunciación)
                    const dist = levenshteinDistance(qStem, c.stem);
                    const maxLen = Math.max(qStem.length, c.stem.length);
                    const similarity = 1 - dist / maxLen;
                    if (dist <= 1 || (maxLen >= 6 && dist <= 2) || similarity >= 0.65) {
                        s = Math.round(48 * similarity);
                    } else if (c.phon.length >= qStem.length) {
                        // Ventana deslizante por prefijo (ej. "uantan" contra prefijo de "uantansitos")
                        const prefix = c.phon.slice(0, qStem.length);
                        const prefixDist = levenshteinDistance(qStem, prefix);
                        if (prefixDist <= 1) {
                            s = 38;
                        }
                    }
                }
                const weighted = Math.round(s * multiplier);
                if (weighted > bestTokenScore) bestTokenScore = weighted;
            }
        };

        evaluateAgainst(primaryPhonetic, 1);
        if (bestTokenScore < 35) {
            evaluateAgainst(secondaryPhonetic, 0.55);
        }

        if (bestTokenScore > 0) {
            matchedWordTokens++;
            totalScore += bestTokenScore;
        }
    }

    // Bonus si coincidieron múltiples palabras del mensaje
    if (matchedWordTokens >= 2) {
        totalScore += matchedWordTokens * 10;
    }

    return totalScore;
}

function formatEcuadorPhoneDisplay(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    // Solo formatear si el texto parece un número telefónico
    if (!/^[\d\s+\-().]+$/.test(trimmed)) return trimmed;
    const digits = trimmed.replace(/\D/g, '');
    let local = '';
    if (digits.length === 10 && digits.startsWith('09')) {
        local = digits.slice(1);
    } else if (digits.length === 12 && digits.startsWith('5939')) {
        local = digits.slice(3);
    } else if (digits.length === 9 && digits.startsWith('9')) {
        local = digits;
    }
    if (local.length === 9) {
        return `+593 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
    }
    return trimmed;
}

function cleanWhatsAppDisplayName(
    candidates: Array<string | undefined | null>,
    fallbackPhone?: string
): string {
    for (const raw of candidates) {
        const trimmed = (raw || '').trim();
        if (!trimmed) continue;
        const clientParenMatch = trimmed.match(/^cliente\s*\(([^)]+)\)$/i);
        if (clientParenMatch?.[1]) {
            return formatEcuadorPhoneDisplay(clientParenMatch[1].trim());
        }
        return formatEcuadorPhoneDisplay(trimmed);
    }
    return formatEcuadorPhoneDisplay((fallbackPhone || '').trim()) || 'WhatsApp';
}

function formatWhatsAppTime(dateInput: Date | number | undefined | null): string {
    if (!dateInput) return '';
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return '';

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfToday - startOfTarget) / (24 * 60 * 60 * 1000));

    if (diffDays <= 0) {
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const period = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12 || 12;
        return `${hours}:${minutes} ${period}`;
    }
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7) {
        const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        return days[d.getDay()];
    }
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
}

function getTodayDateString(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function WhatsAppConversationCard({
    businessId,
    conversation,
    resolvedProfile,
    activeOrder,
    onInspectOrder,
    onOpenChatView,
    products = [],
    onSelect,
    onClose,
    onClientRegistered,
}: {
    businessId?: string;
    conversation: PendingWhatsAppConversation;
    resolvedProfile?: ResolvedWhatsAppClientProfile;
    activeOrder?: any;
    onInspectOrder?: (order: any) => void;
    onOpenChatView?: (
        conv: PendingWhatsAppConversation,
        initialTab?: PreorderTabKey,
        resolvedProfile?: ResolvedWhatsAppClientProfile,
        activeOrder?: any
    ) => void;
    products?: Product[];
    onSelect?: (conv: PendingWhatsAppConversation, draft?: WhatsAppPreorderDraft) => void;
    onClose?: (docId: string) => void;
    onClientRegistered?: (profile: ResolvedWhatsAppClientProfile) => void;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [activeTab, setActiveTab] = useState<PreorderTabKey>('delivery');
    const [showLocationsModal, setShowLocationsModal] = useState(false);

    // Estado de preorden editable directamente desde los 4 íconos
    const [draftItems, setDraftItems] = useState<WhatsAppPreorderDraftItem[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [timingType, setTimingType] = useState<'' | 'immediate' | 'scheduled'>('');
    const [scheduledDate, setScheduledDate] = useState<string>(getTodayDateString);
    const [scheduledTime, setScheduledTime] = useState<string>('');
    const [deliveryType, setDeliveryType] = useState<'' | 'delivery' | 'pickup'>('');
    const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
    const [customLocationInput, setCustomLocationInput] = useState<string>(conversation.detectedLocationLink || '');
    const [paymentMethod, setPaymentMethod] = useState<'' | 'cash' | 'transfer' | 'mixed'>('');
    const [cashAmountInput, setCashAmountInput] = useState<string>('');
    const [transferAmountInput, setTransferAmountInput] = useState<string>('');
    const [newClientName, setNewClientName] = useState<string>('');
    const [isEditingClientName, setIsEditingClientName] = useState<boolean>(false);
    const [savingNewClient, setSavingNewClient] = useState<boolean>(false);
    const focusedFieldRef = useRef<'clientName' | 'productSearch' | 'customLocation' | 'cashAmount' | 'transferAmount' | null>(null);
    const clientNameInputRef = useRef<HTMLInputElement | null>(null);
    const productSearchInputRef = useRef<HTMLInputElement | null>(null);
    const customLocationInputRef = useRef<HTMLInputElement | null>(null);
    const cashAmountInputRef = useRef<HTMLInputElement | null>(null);
    const transferAmountInputRef = useRef<HTMLInputElement | null>(null);

    const handlePasteMessageToActiveField = (rawMessage: string) => {
        const text = rawMessage.trim();
        if (!text) return;

        // Determinar el campo objetivo: el que tiene foco (o el campo visible en la pestaña actual)
        const target =
            focusedFieldRef.current ||
            (isEditingClientName
                ? 'clientName'
                : activeTab === 'products'
                    ? 'productSearch'
                    : activeTab === 'delivery' && effectiveDeliveryType !== 'pickup' && !primaryLocation
                        ? 'customLocation'
                        : null);

        if (target === 'clientName') {
            setNewClientName(text);
            clientNameInputRef.current?.focus();
        } else if (target === 'productSearch') {
            setProductSearch(text);
            productSearchInputRef.current?.focus();
        } else if (target === 'customLocation') {
            setCustomLocationInput(text);
            if (deliveryType !== 'delivery') setDeliveryType('delivery');
            customLocationInputRef.current?.focus();
        } else if (target === 'cashAmount' || target === 'transferAmount') {
            const numMatch = text.replace(',', '.').match(/\d+(?:\.\d{1,2})?/);
            if (numMatch) {
                if (target === 'cashAmount') {
                    setCashAmountInput(numMatch[0]);
                    cashAmountInputRef.current?.focus();
                } else {
                    setTransferAmountInput(numMatch[0]);
                    transferAmountInputRef.current?.focus();
                }
            }
        }
    };

    const displayName = cleanWhatsAppDisplayName(
        [
            resolvedProfile?.clientName,
            conversation.fuddiClientName,
            conversation.effectiveName,
            conversation.displayName,
        ],
        resolvedProfile?.clientPhone || conversation.phone || conversation.rawPhone
    );

    const isRegisteredClient = Boolean(resolvedProfile?.isRegistered || conversation.isRegisteredClient);
    const savedLocations = resolvedProfile?.locations || [];
    const primaryLocation =
        (selectedLocationId ? savedLocations.find(l => l.id === selectedLocationId) : null) ||
        savedLocations.find(l => l.isFavorite) ||
        savedLocations[0] ||
        null;

    const effectiveDeliveryType: '' | 'delivery' | 'pickup' =
        deliveryType || (primaryLocation || customLocationInput.trim() || conversation.detectedLocationLink ? 'delivery' : '');
    const isPickup = effectiveDeliveryType === 'pickup';

    const isProductsComplete = draftItems.length > 0;
    const isImmediateTiming = timingType === 'immediate';
    const isTimingComplete =
        timingType === 'immediate' ||
        (timingType === 'scheduled' && Boolean(scheduledDate && scheduledTime));
    const isDeliveryComplete =
        isPickup || Boolean(primaryLocation || customLocationInput.trim() || conversation.detectedLocationLink);
    const parsedCashAmount = parseFloat(cashAmountInput) || 0;
    const parsedTransferAmount = parseFloat(transferAmountInput) || 0;
    const isPaymentComplete =
        paymentMethod === 'cash' ||
        paymentMethod === 'transfer' ||
        (paymentMethod === 'mixed' && parsedCashAmount > 0 && parsedTransferAmount > 0);

    const timeLabel = formatWhatsAppTime(conversation.timestampMillis || Date.now());

    const cleanPhone = (resolvedProfile?.clientPhone || conversation.rawPhone || conversation.phone || '').replace(/\D/g, '');
    const isUnregisteredClient = !isRegisteredClient && (resolvedProfile !== undefined || cleanPhone.length < 9);
    const messages =
        conversation.recentMessages && conversation.recentMessages.length > 0
            ? conversation.recentMessages
            : conversation.lastMessage
                ? [conversation.lastMessage]
                : [];

    const filteredProducts = useMemo(() => {
        const available = products.filter(p => p.isAvailable !== false);
        const trimmed = productSearch.trim();
        if (!trimmed) return available.slice(0, 6);

        return available
            .map(p => ({ product: p, score: scoreProductSmartMatch(p, trimmed) }))
            .filter(entry => entry.score >= 22)
            .sort((a, b) => b.score - a.score)
            .slice(0, 8)
            .map(entry => entry.product);
    }, [products, productSearch]);

    const handleSaveNewClient = async () => {
        const trimmedName = newClientName.trim();
        const rawPhoneToSave = (resolvedProfile?.clientPhone || conversation.phone || conversation.rawPhone || '').trim();
        if (!trimmedName || !rawPhoneToSave || savingNewClient) return;

        setSavingNewClient(true);
        try {
            const newClientId = await createClient({
                celular: rawPhoneToSave,
                nombres: trimmedName,
            });

            if (businessId && conversation.docId) {
                updateDoc(doc(db, 'businesses', businessId, 'whatsappPending', conversation.docId), {
                    fuddiClientId: newClientId,
                    fuddiClientName: trimmedName,
                    effectiveName: trimmedName,
                    isRegisteredClient: true,
                }).catch(() => {});
            }

            onClientRegistered?.({
                clientId: newClientId,
                clientName: trimmedName,
                clientPhone: rawPhoneToSave,
                isRegistered: true,
                locations: savedLocations,
            });
            setNewClientName('');
            setIsEditingClientName(false);
        } catch (err) {
            console.error('[LiveCheckouts] Error saving new client:', err);
        } finally {
            setSavingNewClient(false);
        }
    };

    const handleAddDraftProduct = (product: Product, variantObj?: any) => {
        const variantName = variantObj?.name as string | undefined;
        const priceSource = variantObj || product;
        const unitPrice = getManualOrderStorePrice(priceSource);
        const meta = getPriceMetadata(priceSource);
        const fullName = variantName ? `${product.name} - ${variantName}` : product.name;

        setDraftItems(prev => {
            const idx = prev.findIndex(
                item => item.productId === product.id && (item.variant || '') === (variantName || '')
            );
            if (idx >= 0) {
                return prev.map((item, i) => (i === idx ? { ...item, quantity: item.quantity + 1 } : item));
            }
            return [
                ...prev,
                {
                    productId: product.id,
                    name: fullName,
                    productName: product.name,
                    variant: variantName,
                    variantName,
                    price: unitPrice,
                    quantity: 1,
                    image: product.image,
                    basePrice: meta.basePrice,
                    commission: meta.commission,
                    commissionType: meta.commissionType,
                    storeReceives: meta.storeReceives,
                    ingredients: variantObj?.ingredients || product.ingredients,
                },
            ];
        });
    };

    const handleUpdateDraftItemQty = (index: number, delta: number) => {
        setDraftItems(prev =>
            prev
                .map((item, i) => (i === index ? { ...item, quantity: item.quantity + delta } : item))
                .filter(item => item.quantity > 0)
        );
    };

    const draftSubtotal = useMemo(
        () => draftItems.reduce((acc, item) => acc + item.price * item.quantity, 0),
        [draftItems]
    );

    const enrichedConversation: PendingWhatsAppConversation = resolvedProfile
        ? {
            ...conversation,
            fuddiClientId: resolvedProfile.clientId || conversation.fuddiClientId,
            fuddiClientName: resolvedProfile.clientName || conversation.fuddiClientName,
            effectiveName: resolvedProfile.clientName || conversation.effectiveName,
            phone: resolvedProfile.clientPhone || conversation.phone,
            fuddiClientEmail: resolvedProfile.clientEmail || conversation.fuddiClientEmail,
            fuddiClientNotes: resolvedProfile.clientNotes || conversation.fuddiClientNotes,
            isRegisteredClient,
        }
        : conversation;

    const buildDraft = (): WhatsAppPreorderDraft => ({
        items: draftItems.length > 0 ? draftItems : undefined,
        timingType: timingType || undefined,
        scheduledDate: timingType === 'scheduled' ? scheduledDate : undefined,
        scheduledTime: timingType === 'scheduled' ? scheduledTime : undefined,
        deliveryType: effectiveDeliveryType || undefined,
        selectedLocation: effectiveDeliveryType === 'delivery' ? primaryLocation : null,
        customLocationInput:
            effectiveDeliveryType === 'delivery' && !primaryLocation
                ? (customLocationInput.trim() || conversation.detectedLocationLink || undefined)
                : undefined,
        paymentMethod: paymentMethod || undefined,
        cashAmount: paymentMethod === 'mixed' ? parsedCashAmount : undefined,
        transferAmount: paymentMethod === 'mixed' ? parsedTransferAmount : undefined,
    });

    const stepIndicators: Array<{
        key: PreorderTabKey;
        completed: boolean;
        completedClass: string;
        icon: React.ReactNode;
        title: string;
    }> = [
        {
            key: 'products',
            completed: isProductsComplete,
            completedClass: 'bg-emerald-100 text-emerald-600',
            icon: <i className="bi bi-bag-fill"></i>,
            title: isProductsComplete
                ? `${draftItems.reduce((s, i) => s + i.quantity, 0)} producto(s) agregado(s)`
                : 'Agregar productos',
        },
        {
            key: 'timing',
            completed: isTimingComplete,
            completedClass: isImmediateTiming
                ? 'bg-amber-100 text-amber-500'
                : 'bg-emerald-100 text-emerald-600',
            icon: <i className={`bi ${isImmediateTiming ? 'bi-lightning-charge-fill' : 'bi-clock-fill'}`}></i>,
            title: isTimingComplete
                ? timingType === 'scheduled'
                    ? `Programado: ${scheduledDate} ${scheduledTime}`
                    : 'Entrega inmediata'
                : 'Elegir horario',
        },
        {
            key: 'delivery',
            completed: isDeliveryComplete,
            completedClass: 'bg-emerald-100 text-emerald-600',
            icon: isPickup ? <i className="bi bi-shop"></i> : <Motorbike className="w-3.5 h-3.5" strokeWidth={2.2} />,
            title: isPickup
                ? 'Recoger en tienda'
                : primaryLocation
                    ? `Dirección: ${primaryLocation.referencia || primaryLocation.sector || 'Guardada'}`
                    : customLocationInput.trim()
                        ? 'Ubicación ingresada'
                        : 'Elegir dirección o recoger en tienda',
        },
        {
            key: 'payment',
            completed: isPaymentComplete,
            completedClass: 'bg-emerald-100 text-emerald-600',
            icon: <i className={`bi ${paymentMethod === 'cash' ? 'bi-cash-coin' : 'bi-credit-card-fill'}`}></i>,
            title: isPaymentComplete
                ? paymentMethod === 'cash'
                    ? 'Pago en efectivo'
                    : paymentMethod === 'transfer'
                        ? 'Pago por transferencia'
                        : 'Pago mixto'
                : 'Elegir método de pago',
        },
    ];

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200/90 overflow-hidden transition-all hover:border-green-300 hover:shadow-sm">
            {/* Header: Click to open dedicated chat view (or fallback accordion) */}
            <div
                className="p-3 sm:p-3.5 bg-white cursor-pointer hover:bg-green-50/30 transition-colors space-y-2"
                onClick={() => {
                    if (onOpenChatView) {
                        onOpenChatView(enrichedConversation, undefined, resolvedProfile, activeOrder);
                    } else {
                        setIsExpanded(!isExpanded);
                    }
                }}
            >
                {/* Top row: Name (or inline name editor) left, WhatsApp-style time top-right */}
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <i className="bi bi-whatsapp text-green-600 shrink-0 text-sm"></i>
                        {isEditingClientName ? (
                            <div
                                className="flex items-center gap-1 flex-1 min-w-0"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <input
                                    ref={clientNameInputRef}
                                    type="text"
                                    value={newClientName}
                                    onFocus={() => { focusedFieldRef.current = 'clientName'; }}
                                    onChange={(e) => setNewClientName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            void handleSaveNewClient();
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault();
                                            setIsEditingClientName(false);
                                            setNewClientName('');
                                        }
                                    }}
                                    placeholder="Nombre del cliente..."
                                    className="flex-1 min-w-0 h-7 px-2 text-xs font-semibold text-gray-900 bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                                />
                                <button
                                    type="button"
                                    style={{ minHeight: 0, minWidth: 0 }}
                                    disabled={!newClientName.trim() || savingNewClient}
                                    onClick={() => void handleSaveNewClient()}
                                    className="w-7 h-7 min-h-0 min-w-0 p-0 shrink-0 rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white inline-flex items-center justify-center transition-colors"
                                    title="Guardar cliente"
                                >
                                    {savingNewClient ? (
                                        <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
                                    ) : (
                                        <i className="bi bi-check2 text-sm"></i>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    style={{ minHeight: 0, minWidth: 0 }}
                                    onClick={() => {
                                        setIsEditingClientName(false);
                                        setNewClientName('');
                                    }}
                                    className="w-7 h-7 min-h-0 min-w-0 p-0 shrink-0 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-500 inline-flex items-center justify-center transition-colors"
                                    title="Cancelar"
                                >
                                    <i className="bi bi-x text-sm"></i>
                                </button>
                            </div>
                        ) : (
                            <>
                                <span className="text-sm font-black text-gray-900 tracking-tight truncate">
                                    {displayName}
                                </span>
                                {isUnregisteredClient && (
                                    <button
                                        type="button"
                                        style={{ minHeight: 0 }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsEditingClientName(true);
                                            setTimeout(() => clientNameInputRef.current?.focus(), 30);
                                        }}
                                        className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-all cursor-pointer"
                                        title="Clic para registrar nombre del cliente en Fuddi"
                                    >
                                        <i className="bi bi-person-plus-fill"></i>
                                        Nuevo
                                    </button>
                                )}
                                {activeOrder && (
                                    <button
                                        type="button"
                                        style={{ minHeight: 0 }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onInspectOrder?.(activeOrder);
                                        }}
                                        className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-all cursor-pointer"
                                        title={
                                            activeOrder.timing?.type === 'scheduled' && activeOrder.timing?.scheduledTime
                                                ? `Orden activa programada (${activeOrder.timing.scheduledTime}) — Clic para ver`
                                                : 'Este cliente tiene una orden activa — Clic para ver'
                                        }
                                    >
                                        <i className="bi bi-bag-check-fill"></i>
                                        Orden activa
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                    {timeLabel && !isEditingClientName && (
                        <span className="shrink-0 text-[11px] font-medium text-gray-400 whitespace-nowrap">
                            {timeLabel}
                        </span>
                    )}
                </div>

                {/* Second row: Last 3 messages left + icons & compact action buttons right */}
                <div className="flex items-start justify-between gap-2.5">
                    <div className="flex-1 min-w-0 space-y-0.5">
                        {messages.slice(-3).map((msg, idx) => (
                            <p key={idx} className="text-[11px] leading-snug text-gray-600 line-clamp-1">
                                {msg}
                            </p>
                        ))}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                        <div className="flex items-center gap-1.5">
                            <div className="flex items-center gap-1.5">
                                {stepIndicators.map(step => {
                                    const isActive = isExpanded && activeTab === step.key;
                                    return (
                                        <button
                                            key={step.key}
                                            type="button"
                                            title={step.title}
                                            style={{ minHeight: 0, minWidth: 0 }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (onOpenChatView) {
                                                    onOpenChatView(enrichedConversation, step.key, resolvedProfile, activeOrder);
                                                } else {
                                                    setActiveTab(step.key);
                                                    setIsExpanded(true);
                                                }
                                            }}
                                            className={`w-7 h-7 min-h-0 min-w-0 p-0 shrink-0 rounded-full inline-flex items-center justify-center text-xs leading-none transition-all cursor-pointer ${
                                                step.completed
                                                    ? step.completedClass
                                                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200/80'
                                            } ${isActive ? 'ring-2 ring-blue-500/80 ring-offset-1' : 'hover:ring-2 hover:ring-gray-300'}`}
                                        >
                                            {step.icon}
                                        </button>
                                    );
                                })}
                            </div>
                            <span className="text-gray-400 text-xs flex items-center pl-0.5 font-medium">
                                <i className={`bi ${onOpenChatView ? 'bi-chevron-right' : `bi-chevron-${isExpanded ? 'up' : 'down'}`} transition-transform duration-200`}></i>
                            </span>
                        </div>

                        {!isExpanded && (
                            <div className="flex items-center justify-end gap-1.5">
                                {onClose && (
                                    <button
                                        type="button"
                                        style={{ minHeight: 0 }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onClose(conversation.docId);
                                        }}
                                        className="h-7 min-h-0 inline-flex items-center justify-center gap-1 bg-white hover:bg-gray-100 active:scale-95 text-gray-600 border border-gray-200 text-[11px] font-bold px-2.5 rounded-lg transition-all shrink-0 whitespace-nowrap"
                                        title="Marcar como atendido"
                                    >
                                        <i className="bi bi-check2 text-xs"></i>
                                        <span>Cerrar</span>
                                    </button>
                                )}
                                {onSelect && (
                                    <button
                                        type="button"
                                        style={{ minHeight: 0 }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSelect(enrichedConversation, buildDraft());
                                        }}
                                        className="h-7 min-h-0 inline-flex items-center justify-center gap-1 bg-red-600 hover:bg-red-700 active:scale-95 text-white text-[11px] font-bold px-2.5 rounded-lg transition-all shadow-xs shrink-0 whitespace-nowrap"
                                        title="Completar preorden en formulario de orden manual"
                                    >
                                        <i className="bi bi-cart-plus-fill text-[11px]"></i>
                                        <span>Crear pedido</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Expanded Details */}
            {isExpanded && (
                <div className="px-3 sm:px-3.5 pb-3.5 pt-2.5 bg-gray-50/70 border-t border-gray-100 space-y-3">
                    {/* Sección interactiva según el ícono seleccionado */}
                    {activeTab === 'products' && (
                        <div
                            className="bg-white border border-blue-100 rounded-lg p-2.5 space-y-2.5"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700 flex items-center gap-1">
                                    <i className="bi bi-bag-fill"></i>
                                    Productos de la preorden
                                </p>
                                {draftItems.length > 0 && (
                                    <span className="text-xs font-black text-gray-900">
                                        ${draftSubtotal.toFixed(2)}
                                    </span>
                                )}
                            </div>

                            {draftItems.length > 0 && (
                                <div className="space-y-1.5">
                                    {draftItems.map((item, idx) => (
                                        <div
                                            key={`${item.productId}-${item.variant || ''}`}
                                            className="flex items-center justify-between gap-2 bg-emerald-50/60 border border-emerald-100 rounded-md px-2 py-1 text-xs"
                                        >
                                            <span className="font-semibold text-gray-800 truncate flex-1">
                                                {item.name}
                                            </span>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    type="button"
                                                    style={{ minHeight: 0, minWidth: 0 }}
                                                    onClick={() => handleUpdateDraftItemQty(idx, -1)}
                                                    className="w-5 h-5 min-h-0 min-w-0 rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold"
                                                >
                                                    -
                                                </button>
                                                <span className="w-5 text-center font-bold text-gray-900">{item.quantity}</span>
                                                <button
                                                    type="button"
                                                    style={{ minHeight: 0, minWidth: 0 }}
                                                    onClick={() => handleUpdateDraftItemQty(idx, 1)}
                                                    className="w-5 h-5 min-h-0 min-w-0 rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold"
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <input
                                ref={productSearchInputRef}
                                type="text"
                                value={productSearch}
                                onFocus={() => { focusedFieldRef.current = 'productSearch'; }}
                                onChange={(e) => setProductSearch(e.target.value)}
                                placeholder="Buscar producto (o toca un mensaje)..."
                                className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                            />

                            {filteredProducts.length > 0 ? (
                                <div className="max-h-36 overflow-y-auto divide-y divide-gray-100">
                                    {filteredProducts.map(prod => {
                                        const hasVariants = Array.isArray(prod.variants) && prod.variants.length > 0;
                                        if (hasVariants) {
                                            return (
                                                <div key={prod.id} className="py-1.5 space-y-1">
                                                    <p className="text-[11px] font-bold text-gray-800">{prod.name}</p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {prod.variants!.map(v => (
                                                            <button
                                                                key={v.name}
                                                                type="button"
                                                                style={{ minHeight: 0 }}
                                                                onClick={() => handleAddDraftProduct(prod, v)}
                                                                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 hover:bg-emerald-100 hover:text-emerald-700 text-gray-700 transition-colors"
                                                            >
                                                                + {v.name} (${getManualOrderStorePrice(v).toFixed(2)})
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return (
                                            <button
                                                key={prod.id}
                                                type="button"
                                                style={{ minHeight: 0 }}
                                                onClick={() => handleAddDraftProduct(prod)}
                                                className="w-full py-1.5 px-1 text-left hover:bg-emerald-50/60 rounded flex items-center justify-between gap-2 text-xs transition-colors"
                                            >
                                                <span className="font-medium text-gray-800 truncate">{prod.name}</span>
                                                <span className="shrink-0 font-bold text-emerald-700">
                                                    + ${getManualOrderStorePrice(prod).toFixed(2)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-[11px] text-gray-400 text-center py-1">No se encontraron productos</p>
                            )}
                        </div>
                    )}

                    {activeTab === 'timing' && (
                        <div
                            className="bg-white border border-amber-100 rounded-lg p-2.5 space-y-2.5"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-1">
                                <i className="bi bi-clock-fill text-amber-500"></i>
                                Horario de entrega
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setTimingType('immediate')}
                                    className={`py-2 px-2.5 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                                        timingType === 'immediate'
                                            ? 'bg-amber-50 border-amber-300 text-amber-700 ring-1 ring-amber-300'
                                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}
                                >
                                    <i className="bi bi-lightning-charge-fill text-amber-500"></i>
                                    Inmediato
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTimingType('scheduled')}
                                    className={`py-2 px-2.5 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                                        timingType === 'scheduled'
                                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-1 ring-emerald-300'
                                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}
                                >
                                    <i className="bi bi-clock-fill text-emerald-600"></i>
                                    Programado
                                </button>
                            </div>
                            {timingType === 'scheduled' && (
                                <div className="grid grid-cols-2 gap-2 pt-0.5">
                                    <input
                                        type="date"
                                        value={scheduledDate}
                                        onChange={(e) => setScheduledDate(e.target.value)}
                                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
                                    />
                                    <input
                                        type="time"
                                        value={scheduledTime}
                                        onChange={(e) => setScheduledTime(e.target.value)}
                                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'delivery' && (
                        <div
                            className="bg-white border border-emerald-100 rounded-lg p-2.5 space-y-2"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="grid grid-cols-2 gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setDeliveryType('delivery')}
                                    className={`py-1.5 px-2 rounded-md border text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                                        effectiveDeliveryType !== 'pickup'
                                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}
                                >
                                    <Motorbike className="w-3.5 h-3.5" strokeWidth={2.2} />
                                    Delivery
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDeliveryType('pickup')}
                                    className={`py-1.5 px-2 rounded-md border text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                                        effectiveDeliveryType === 'pickup'
                                            ? 'bg-amber-50 border-amber-300 text-amber-700'
                                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}
                                >
                                    <i className="bi bi-shop"></i>
                                    Recoger en tienda
                                </button>
                            </div>

                            {effectiveDeliveryType === 'pickup' ? (
                                <p className="text-xs text-amber-700 font-medium bg-amber-50/70 rounded-md px-2.5 py-2 flex items-center gap-1.5">
                                    <i className="bi bi-shop"></i>
                                    El cliente retirará el pedido en el local
                                </p>
                            ) : primaryLocation ? (
                                <button
                                    type="button"
                                    onClick={() => setShowLocationsModal(true)}
                                    className="w-full text-left bg-emerald-50/30 hover:bg-emerald-50/70 border border-emerald-100 hover:border-emerald-200 rounded-lg px-2.5 py-2 text-xs text-gray-700 flex items-start justify-between gap-2 transition-colors"
                                >
                                    <div className="flex items-start gap-2 min-w-0">
                                        <i className="bi bi-geo-alt-fill text-emerald-600 mt-0.5 shrink-0"></i>
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                                                Dirección guardada
                                            </p>
                                            <p className="font-medium text-gray-800 leading-snug">
                                                {primaryLocation.referencia || primaryLocation.sector || 'Ubicación registrada'}
                                                {primaryLocation.sector && primaryLocation.referencia ? ` · ${primaryLocation.sector}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="shrink-0 text-[10px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5">
                                        {savedLocations.length > 1 ? `Ver todas (${savedLocations.length})` : 'Ver mapa'}
                                    </span>
                                </button>
                            ) : (
                                <input
                                    ref={customLocationInputRef}
                                    type="text"
                                    value={customLocationInput}
                                    onFocus={() => { focusedFieldRef.current = 'customLocation'; }}
                                    onChange={(e) => {
                                        setCustomLocationInput(e.target.value);
                                        if (deliveryType !== 'delivery') setDeliveryType('delivery');
                                    }}
                                    placeholder="Pegar enlace de Google Maps o escribir dirección..."
                                    className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
                                />
                            )}
                        </div>
                    )}

                    {activeTab === 'payment' && (
                        <div
                            className="bg-white border border-gray-200 rounded-lg p-2.5 space-y-2"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-1">
                                <i className="bi bi-credit-card-fill text-emerald-600"></i>
                                Método de pago
                            </p>
                            <div className="grid grid-cols-3 gap-1.5">
                                {[
                                    { key: 'cash' as const, label: 'Efectivo', icon: 'bi-cash-coin' },
                                    { key: 'transfer' as const, label: 'Transfer.', icon: 'bi-bank' },
                                    { key: 'mixed' as const, label: 'Mixto', icon: 'bi-wallet2' },
                                ].map(opt => (
                                    <button
                                        key={opt.key}
                                        type="button"
                                        onClick={() => setPaymentMethod(opt.key)}
                                        className={`py-2 px-2 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                                            paymentMethod === opt.key
                                                ? 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-1 ring-emerald-300'
                                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                        }`}
                                    >
                                        <i className={`bi ${opt.icon}`}></i>
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                            {paymentMethod === 'mixed' && (
                                <div className="grid grid-cols-2 gap-2 pt-1">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                                            Efectivo ($)
                                        </label>
                                        <input
                                            ref={cashAmountInputRef}
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={cashAmountInput}
                                            onFocus={() => { focusedFieldRef.current = 'cashAmount'; }}
                                            onChange={(e) => setCashAmountInput(e.target.value)}
                                            placeholder="0.00"
                                            className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                                            Transferencia ($)
                                        </label>
                                        <input
                                            ref={transferAmountInputRef}
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={transferAmountInput}
                                            onFocus={() => { focusedFieldRef.current = 'transferAmount'; }}
                                            onChange={(e) => setTransferAmountInput(e.target.value)}
                                            placeholder="0.00"
                                            className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {messages.length > 0 && (
                        <div className="space-y-1.5">
                            {messages.slice(-5).map((msg, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    style={{ minHeight: 0 }}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handlePasteMessageToActiveField(msg);
                                    }}
                                    title="Toca para pegar en el campo activo"
                                    className="w-full text-left bg-white hover:bg-blue-50/50 border border-gray-200/80 hover:border-blue-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 whitespace-pre-wrap break-words transition-colors cursor-pointer"
                                >
                                    {msg}
                                </button>
                            ))}
                        </div>
                    )}

                    {conversation.detectedLocationLink && (
                        <a
                            href={conversation.detectedLocationLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700"
                        >
                            <i className="bi bi-geo-alt-fill"></i>
                            Ver ubicación enviada
                        </a>
                    )}

                    <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                        <div>
                            {cleanPhone && (
                                <a
                                    href={`https://wa.me/${cleanPhone}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ minHeight: 0 }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-7 min-h-0 px-2.5 bg-white hover:bg-green-50 text-green-700 border border-green-200 text-[11px] font-bold rounded-lg transition-colors inline-flex items-center justify-center gap-1.5"
                                >
                                    <i className="bi bi-whatsapp"></i>
                                    Chat
                                </a>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 ml-auto">
                            {onClose && (
                                <button
                                    type="button"
                                    style={{ minHeight: 0 }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onClose(conversation.docId);
                                    }}
                                    className="h-7 min-h-0 inline-flex items-center justify-center gap-1 bg-white hover:bg-gray-100 active:scale-95 text-gray-600 border border-gray-200 text-[11px] font-bold px-2.5 rounded-lg transition-all shrink-0 whitespace-nowrap"
                                    title="Marcar como atendido"
                                >
                                    <i className="bi bi-check2 text-xs"></i>
                                    <span>Cerrar</span>
                                </button>
                            )}
                            {onSelect && (
                                <button
                                    type="button"
                                    style={{ minHeight: 0 }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onSelect(enrichedConversation, buildDraft());
                                    }}
                                    className="h-7 min-h-0 inline-flex items-center justify-center gap-1 bg-red-600 hover:bg-red-700 active:scale-95 text-white text-[11px] font-bold px-2.5 rounded-lg transition-all shadow-xs shrink-0 whitespace-nowrap"
                                    title="Completar preorden en formulario de orden manual"
                                >
                                    <i className="bi bi-cart-plus-fill text-[11px]"></i>
                                    <span>Crear pedido</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <ClientLocationsModal
                isOpen={showLocationsModal}
                title="Seleccionar ubicación"
                subtitle={displayName}
                locations={savedLocations}
                selectedLocationId={primaryLocation?.id}
                onClose={() => setShowLocationsModal(false)}
                onSelectLocation={(location) => {
                    setSelectedLocationId(location.id);
                    setDeliveryType('delivery');
                    setShowLocationsModal(false);
                }}
            />
        </div>
    );
}

function CheckoutSessionCard({
    session,
    onOpenManualOrder,
    linkedWhatsApp,
    onCloseWhatsApp,
    onCloseCheckout,
}: {
    session: CheckoutSession;
    onOpenManualOrder?: (session: CheckoutSession) => void;
    linkedWhatsApp?: PendingWhatsAppConversation;
    onCloseWhatsApp?: (docId: string) => void;
    onCloseCheckout?: () => void;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [mapExpanded, setMapExpanded] = useState(false);

    const checkoutDate = getSessionUpdatedDate(session);
    const lastUpdate = linkedWhatsApp?.timestampMillis && linkedWhatsApp.timestampMillis > checkoutDate.getTime()
        ? new Date(linkedWhatsApp.timestampMillis)
        : checkoutDate;
    const timeLabel = formatWhatsAppTime(lastUpdate);

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

    // Estado de completitud por paso del checkout (omitiendo Paso 1: Cliente)
    const isTimingComplete =
        session.timingData?.type === 'immediate' ||
        (session.timingData?.type === 'scheduled' &&
            Boolean(session.timingData?.scheduledDate && session.timingData?.scheduledTime));

    const isDeliveryComplete =
        session.deliveryData?.type === 'pickup' ||
        (session.deliveryData?.type === 'delivery' &&
            Boolean(session.deliveryData?.address?.trim() || session.deliveryData?.latlong));

    const isPaymentComplete =
        session.paymentData?.method === 'cash' ||
        session.paymentData?.method === 'mixed' ||
        (session.paymentData?.method === 'transfer' && Boolean(session.paymentData?.receiptImageUrl));

    const isProductsComplete = Boolean(session.cartItems && session.cartItems.length > 0);
    const isImmediateTiming = session.timingData?.type === 'immediate';

    const stepIndicators = [
        {
            key: 'products',
            completed: isProductsComplete,
            completedClass: 'bg-emerald-100 text-emerald-600',
            icon: <i className="bi bi-bag-fill"></i>,
            title: isProductsComplete
                ? `${session.cartItems.length} producto${session.cartItems.length !== 1 ? 's' : ''} en carrito`
                : 'Falta elegir productos',
        },
        {
            key: 'timing',
            completed: isTimingComplete,
            completedClass: isImmediateTiming
                ? 'bg-amber-100 text-amber-500'
                : 'bg-emerald-100 text-emerald-600',
            icon: <i className={`bi ${isImmediateTiming ? 'bi-lightning-charge-fill' : 'bi-clock-fill'}`}></i>,
            title: isTimingComplete
                ? session.timingData?.type === 'scheduled'
                    ? 'Horario programado completo'
                    : 'Entrega inmediata seleccionada'
                : 'Falta elegir horario',
        },
        {
            key: 'delivery',
            completed: isDeliveryComplete,
            completedClass: 'bg-emerald-100 text-emerald-600',
            icon: isPickup ? <i className="bi bi-shop"></i> : <Motorbike className="w-3.5 h-3.5" strokeWidth={2.2} />,
            title: isDeliveryComplete
                ? isPickup
                    ? 'Recoger en tienda'
                    : 'Dirección de entrega completa'
                : 'Falta completar entrega',
        },
        {
            key: 'payment',
            completed: isPaymentComplete,
            completedClass: 'bg-emerald-100 text-emerald-600',
            icon: <i className={`bi ${session.paymentData?.method === 'cash' ? 'bi-cash-coin' : 'bi-credit-card-fill'}`}></i>,
            title: isPaymentComplete
                ? 'Pago completo'
                : session.paymentData?.method === 'transfer'
                    ? 'Falta subir comprobante de transferencia'
                    : 'Falta elegir método de pago',
        },
    ];

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
                className="p-3 sm:p-3.5 bg-white cursor-pointer hover:bg-slate-50/80 transition-colors space-y-2"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* Top row: Name left, WhatsApp-style time top-right */}
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <i className="bi bi-person-fill text-blue-500 shrink-0 text-sm"></i>
                        <span className="text-sm font-black text-gray-900 tracking-tight truncate">
                            {session.customerData?.name || linkedWhatsApp?.effectiveName || linkedWhatsApp?.displayName || "Cliente anónimo"}
                        </span>
                        {linkedWhatsApp && (
                            <i className="bi bi-whatsapp text-green-600 shrink-0 text-xs" title="Con mensajes de WhatsApp"></i>
                        )}
                    </div>
                    {timeLabel && (
                        <span className="shrink-0 text-[11px] font-medium text-gray-400 whitespace-nowrap">
                            {timeLabel}
                        </span>
                    )}
                </div>

                {/* Second row: Quick Items Preview left + step icons & chevron right */}
                <div className="flex items-center justify-between gap-2.5">
                    <div className="flex-1 min-w-0 space-y-0.5">
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

                    <div className="shrink-0 flex items-center gap-1.5">
                        <div className="flex items-center gap-1.5">
                            {stepIndicators.map(step => (
                                <span
                                    key={step.key}
                                    title={step.title}
                                    className={`w-7 h-7 rounded-full inline-flex items-center justify-center text-xs transition-colors ${
                                        step.completed
                                            ? step.completedClass
                                            : 'bg-gray-100 text-gray-400'
                                    }`}
                                >
                                    {step.icon}
                                </span>
                            ))}
                        </div>
                        <span className="text-gray-400 text-xs flex items-center pl-0.5 font-medium">
                            <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} transition-transform duration-200`}></i>
                        </span>
                    </div>
                </div>

                {/* Bottom action row */}
                <div className="flex items-center justify-end gap-1.5 pt-0.5">
                    {onCloseCheckout && (
                        <button
                            type="button"
                            style={{ minHeight: 0 }}
                            onClick={(e) => {
                                e.stopPropagation();
                                onCloseCheckout();
                            }}
                            className="h-7 min-h-0 inline-flex items-center justify-center gap-1 bg-white hover:bg-gray-100 active:scale-95 text-gray-600 border border-gray-200 text-[11px] font-bold px-2.5 rounded-lg transition-all shrink-0 whitespace-nowrap"
                            title="Cerrar sesión de checkout"
                        >
                            <i className="bi bi-check2 text-xs"></i>
                            <span>Cerrar</span>
                        </button>
                    )}
                    <button
                        type="button"
                        style={{ minHeight: 0 }}
                        onClick={handleCompleteCheckout}
                        className="h-7 min-h-0 inline-flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-[11px] font-bold px-2.5 rounded-lg transition-all shadow-xs shrink-0 whitespace-nowrap"
                        title="Completar información en formulario de orden manual"
                    >
                        <i className="bi bi-pencil-square text-[11px]"></i>
                        <span>Completar</span>
                    </button>
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

                    {/* Linked WhatsApp Messages */}
                    {linkedWhatsApp && (
                        <div className="bg-green-50/50 p-3 rounded-lg border border-green-200/80 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[10px] font-bold text-green-700 uppercase tracking-wider flex items-center gap-1.5">
                                    <i className="bi bi-whatsapp"></i>
                                    Mensajes de WhatsApp
                                </p>
                                {onCloseWhatsApp && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onCloseWhatsApp(linkedWhatsApp.docId);
                                        }}
                                        className="text-[10px] font-bold text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-white/80 transition-colors"
                                        title="Marcar conversación como atendida"
                                    >
                                        <i className="bi bi-check2 mr-0.5"></i>
                                        Cerrar chat
                                    </button>
                                )}
                            </div>
                            <div className="space-y-1.5">
                                {(linkedWhatsApp.recentMessages && linkedWhatsApp.recentMessages.length > 0
                                    ? linkedWhatsApp.recentMessages
                                    : linkedWhatsApp.lastMessage
                                        ? [linkedWhatsApp.lastMessage]
                                        : []
                                ).slice(-5).map((msg, idx) => (
                                    <div
                                        key={idx}
                                        className="bg-white border border-green-100 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 whitespace-pre-wrap break-words"
                                    >
                                        {msg}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
