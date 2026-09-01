'use client'

import { Timestamp } from 'firebase/firestore'
import { Order, Business, CoverageZone } from '@/types'
import {
    getDeliveriesByStatus,
    getCoverageZones,
    isPointInPolygon,
} from '@/lib/database'

// ── Constants ──────────────────────────────────────────────────────────

export const MUNCHYS_BUSINESS_ID = '0FeNtdYThoTRMPJ6qaS7'

// ── Date Helpers ───────────────────────────────────────────────────────

/** Convert any Firestore-compatible timestamp value to a JS Date safely. */
export const toSafeDate = (val: any): Date => {
    if (!val) return new Date()
    if (val instanceof Timestamp) return val.toDate()
    if (typeof val.toDate === 'function') return val.toDate()
    if (val.seconds) return new Date(val.seconds * 1000)
    if (typeof val === 'string') {
        const dateOnlyMatch = val.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (dateOnlyMatch) {
            const [, year, month, day] = dateOnlyMatch
            return new Date(Number(year), Number(month) - 1, Number(day))
        }
        return new Date(val)
    }
    if (val instanceof Date) return val
    return new Date()
}

export const toLocalDateInputValue = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

// ── Order Helpers ──────────────────────────────────────────────────────

/** Get the display time string for an order (scheduled time or creation time). */
export const getOrderDisplayTime = (order: Order) => {
    try {
        if (order.timing?.scheduledTime) {
            return order.timing.scheduledTime; // Already formatted as HH:MM
        }
        const date = toSafeDate(order.createdAt);
        return date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '--:--';
    }
}

export const isActiveDashboardOrder = (order: Order) =>
    ['borrador', 'pending', 'confirmed', 'preparing', 'ready', 'on_way'].includes(order.status)

export const getOrderReferenceDateForBadge = (order: Order) =>
    order.timing?.type === 'scheduled' && order.timing.scheduledDate
        ? toSafeDate(order.timing.scheduledDate)
        : toSafeDate(order.createdAt)

export const isPreviousActiveOrder = (order: Order) => {
    if (!isActiveDashboardOrder(order)) return false

    const today = new Date()
    const orderDate = getOrderReferenceDateForBadge(order)

    return orderDate.getFullYear() !== today.getFullYear()
        || orderDate.getMonth() !== today.getMonth()
        || orderDate.getDate() !== today.getDate()
}

export const getConfiguredDeliveryTime = (business?: Business | null) => {
    return business?.defaultDeliveryTime ?? business?.deliveryTime ?? 30
}

// ── Status Helpers ─────────────────────────────────────────────────────

export const getStatusText = (status: string) => {
    switch (status) {
        case 'pending': return 'Pendiente'
        case 'borrador': return 'Borrador'
        case 'confirmed': return 'Confirmado'
        case 'preparing': return 'Preparando'
        case 'ready': return 'Listo para entrega'
        case 'on_way': return 'En camino'
        case 'delivered': return 'Entregado'
        case 'cancelled': return 'Descartado'
        default: return status
    }
}

export const getStatusColor = (status: string) => {
    switch (status) {
        case 'pending': return 'bg-yellow-100 text-yellow-800'
        case 'borrador': return 'bg-orange-100 text-orange-800'
        case 'confirmed': return 'bg-blue-100 text-blue-800'
        case 'preparing': return 'bg-purple-100 text-purple-800'
        case 'ready': return 'bg-green-100 text-green-800'
        case 'on_way': return 'bg-indigo-100 text-indigo-800'
        case 'delivered': return 'bg-gray-100 text-gray-800'
        case 'cancelled': return 'bg-red-100 text-red-800'
        default: return 'bg-gray-100 text-gray-800'
    }
}

export const getActionIcon = (status: string) => {
    switch (status) {
        case 'preparing': return 'bi-fire text-purple-500'
        case 'ready': return 'bi-check2 text-green-600'
        case 'on_way': return 'bi-bicycle text-indigo-500'
        case 'delivered': return 'bi-stars text-purple-500'
        default: return 'bi-arrow-right'
    }
}

export const getActionText = (status: string) => {
    switch (status) {
        case 'confirmed': return 'Confirmar'
        case 'preparing': return 'Preparando'
        case 'ready': return 'Listo para la entrega'
        case 'on_way': return 'En camino'
        case 'delivered': return 'Entregado'
        default: return getStatusText(status)
    }
}

export const getActionEmoji = (status: string) => {
    switch (status) {
        case 'preparing': return '🔥'
        case 'ready': return '✔️'
        case 'on_way': return '🛵'
        case 'delivered': return '🎉'
        default: return '➡️'
    }
}

// ── Delivery Helpers ───────────────────────────────────────────────────

export const getDeliveryCoordinates = (order: Order | null) => {
    if (!order?.delivery) return null
    if (typeof order.delivery.mapLocation?.lat === 'number' && typeof order.delivery.mapLocation?.lng === 'number') {
        return {
            lat: order.delivery.mapLocation.lat,
            lng: order.delivery.mapLocation.lng
        }
    }

    const latlong = order.delivery.latlong
    if (!latlong || latlong.startsWith('pluscode:')) return null
    const [lat, lng] = latlong.split(',').map(value => Number(value.trim()))

    if (Number.isNaN(lat) || Number.isNaN(lng)) return null
    return { lat, lng }
}

export const getDeliveryZone = (order: Order | null) => {
    const delivery = order?.delivery as any
    return delivery?.sector || delivery?.address || delivery?.zoneName || delivery?.coverageZoneName || 'No especificado'
}

// ── Auto-assign Logic ──────────────────────────────────────────────────

export const autoAssignDeliveryForOrder = async (order: Order, businessOrDeliveryId?: Business | string): Promise<string | undefined> => {
    try {
        const deliveries = await getDeliveriesByStatus('activo');
        let assignedDeliveryId: string | undefined = undefined;

        const businessObj = typeof businessOrDeliveryId === 'object' ? businessOrDeliveryId : undefined;
        let defaultDeliveryId = typeof businessOrDeliveryId === 'string' ? businessOrDeliveryId : businessObj?.defaultDeliveryId;

        // 1. Verificar si la ubicación del pedido cae en una zona con repartidor asignado por la tienda
        const latlong = order.delivery?.latlong;
        let matchingZone: CoverageZone | undefined = undefined;

        if (latlong && !latlong.startsWith('pluscode:')) {
            const [lat, lng] = latlong.split(',').map(Number);
            if (!isNaN(lat) && !isNaN(lng)) {
                const zones = await getCoverageZones();
                matchingZone = zones.find(zone =>
                    zone.isActive &&
                    isPointInPolygon({ lat, lng }, zone.polygon)
                );

                // Si la tienda configuró un repartidor específico para esta zona:
                if (matchingZone && businessObj?.deliveryZoneSettings?.zones?.[matchingZone.id]?.defaultDeliveryId) {
                    const zoneSpecificDeliveryId = businessObj.deliveryZoneSettings.zones[matchingZone.id].defaultDeliveryId;
                    const zoneDriver = deliveries.find(d => d.id === zoneSpecificDeliveryId);
                    if (zoneDriver) {
                        console.log(`[AutoAssign] Using zone-specific default delivery for ${matchingZone.name}:`, zoneSpecificDeliveryId);
                        return zoneDriver.id;
                    }
                }
            }
        }

        // 2. Si no hay repartidor por zona, usar el repartidor predeterminado general de la tienda
        if (defaultDeliveryId) {
            const defaultDelivery = deliveries.find(d => d.id === defaultDeliveryId);
            if (defaultDelivery) {
                console.log('[AutoAssign] Using store general default delivery:', defaultDeliveryId);
                return defaultDelivery.id;
            }
        }

        // 3. Repartidor asignado a nivel global en la zona
        if (matchingZone?.assignedDeliveryId) {
            const zoneDelivery = deliveries.find(d => d.id === matchingZone.assignedDeliveryId);
            if (zoneDelivery) {
                assignedDeliveryId = zoneDelivery.id;
            }
        }

        // 4. Fallbacks
        if (!assignedDeliveryId) {
            const pedroDelivery = deliveries.find(d => d.celular === '0990815097');
            if (pedroDelivery) {
                assignedDeliveryId = pedroDelivery.id;
            } else {
                const sergioDelivery = deliveries.find(d => d.celular === '0978697867');
                if (sergioDelivery) {
                    assignedDeliveryId = sergioDelivery.id;
                }
            }
        }

        return assignedDeliveryId;
    } catch (error) {
        console.error('Error in autoAssign:', error);
        return undefined;
    }
}
