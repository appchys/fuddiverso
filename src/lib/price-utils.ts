import { Product, ProductVariant } from '@/types'

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

    // If commission is set (e.g., 'fuddi_assumed_by_customer'), 
    // the 'price' field in the database is already updated to be the public price.
    return price;
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
