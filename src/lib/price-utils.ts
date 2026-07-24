import { Business, CommissionType, Product, ProductVariant } from '@/types'

export const DEFAULT_COMMISSION_RATE = 5
export const DEFAULT_COMMISSION_TYPE: CommissionType = 'no_commission'

// Redondear al 0.05 más cercano para evitar centavos extraños en el precio público.
export function roundToNearest005(value: number): number {
    return Math.round(value * 20) / 20
}

export function normalizeCommissionRate(rate?: number): number {
    if (typeof rate !== 'number' || Number.isNaN(rate)) {
        return DEFAULT_COMMISSION_RATE
    }

    return Math.min(Math.max(rate, 0), 100)
}

export function getBusinessCommissionSettings(business?: Partial<Business> | null) {
    return {
        defaultCommissionType: business?.defaultCommissionType || DEFAULT_COMMISSION_TYPE,
        commissionRate: normalizeCommissionRate(business?.commissionRate)
    }
}

export function calculateCommissionPricing(
    storePrice: number,
    commissionType: CommissionType = DEFAULT_COMMISSION_TYPE,
    commissionRate?: number,
    customCommission?: number
) {
    const safeStorePrice = typeof storePrice === 'number' && !Number.isNaN(storePrice) ? storePrice : 0
    const normalizedRate = normalizeCommissionRate(commissionRate)
    const rawCommission = safeStorePrice * (normalizedRate / 100)

    if (commissionType === 'fixed_commission') {
        const commission = typeof customCommission === 'number' && !Number.isNaN(customCommission) ? Math.max(0, customCommission) : 0
        return {
            storePrice: safeStorePrice,
            commission,
            publicPrice: roundToNearest005(safeStorePrice + commission),
            commissionType,
            storeReceives: safeStorePrice
        }
    }

    if (commissionType === 'fuddi_assumed_by_customer') {
        const commission = roundToNearest005(rawCommission)
        return {
            storePrice: safeStorePrice,
            commission,
            publicPrice: roundToNearest005(safeStorePrice + commission),
            commissionType,
            storeReceives: safeStorePrice
        }
    }

    if (commissionType === 'fuddi_assumed_by_store') {
        return {
            storePrice: safeStorePrice,
            commission: rawCommission,
            publicPrice: safeStorePrice,
            commissionType,
            storeReceives: safeStorePrice - rawCommission
        }
    }

    return {
        storePrice: safeStorePrice,
        commission: 0,
        publicPrice: safeStorePrice,
        commissionType: DEFAULT_COMMISSION_TYPE,
        storeReceives: safeStorePrice
    }
}

/**
 * Calculates the public price of a product or variant based on its commission settings.
 * If commission is pending or not set, it returns the base price.
 * If commission is officialized, it returns the final public price.
 */
export function getProductPublicPrice(item: Partial<Product | ProductVariant>): number {
    if (!item) return 0;

    const price = typeof item.price === 'number' ? item.price : 0;
    const basePrice = typeof item.basePrice === 'number' ? item.basePrice : undefined;

    // If commission has not been set (no_commission or missing), use basePrice if available,
    // falling back to price (which in this state should be the same as basePrice).
    if (item.commissionType === 'no_commission' || !item.commissionType) {
        return basePrice !== undefined ? basePrice : price;
    }

    // If commission is set (e.g., 'fuddi_assumed_by_customer' or 'fixed_commission'), 
    // the 'price' field in the database is already updated to be the public price.
    return price;
}

/**
 * Returns the store base price of a product or variant (without commission) for manual orders.
 */
export function getManualOrderStorePrice(item: Partial<Product | ProductVariant>): number {
    if (!item) return 0;
    const basePrice = typeof item.basePrice === 'number' && !Number.isNaN(item.basePrice) ? item.basePrice : undefined;
    const price = typeof item.price === 'number' && !Number.isNaN(item.price) ? item.price : 0;
    return basePrice !== undefined ? basePrice : price;
}

/**
 * Formats a price number as a currency string.
 */
export function formatPrice(price: number): string {
    return `$${price.toFixed(2)}`;
}

/**
 * Returns the full price metadata for a product or variant.
 */
export function getPriceMetadata(item: Partial<Product | ProductVariant>) {
    const commissionType = item.commissionType || 'no_commission';
    const basePrice = typeof item.basePrice === 'number' ? item.basePrice : (typeof item.price === 'number' ? item.price : 0);
    const commission = commissionType === 'no_commission' ? 0 : (typeof item.commission === 'number' ? item.commission : 0);

    // If no_commission, publicPrice = basePrice, otherwise use the 'price' field
    const publicPrice = commissionType === 'no_commission' ? basePrice : (typeof item.price === 'number' ? item.price : 0);

    let storeReceives = basePrice;
    if (commissionType === 'fuddi_assumed_by_store') {
        storeReceives = publicPrice - commission;
    }

    return {
        basePrice,
        commission,
        publicPrice,
        commissionType,
        storeReceives
    };
}

// Central helper to ensure a cart/order item always contains price metadata
export function ensureCartItemMetadata(item: any): any {
  if (!item) return item
  const meta = getPriceMetadata(item)
  return {
    ...item,
    basePrice: item.basePrice ?? meta.basePrice,
    commission: item.commission ?? meta.commission,
    commissionType: item.commissionType ?? meta.commissionType,
    storeReceives: item.storeReceives ?? meta.storeReceives
  }
}
