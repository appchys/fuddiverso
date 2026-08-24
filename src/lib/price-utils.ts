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

export function getPackagingFee(business?: Partial<Business> | null): number {
    if (!business) return 0
    const hasFee = business.hasPackagingFee === true || (business as any).hasPackagingFee === 'true'
    if (!hasFee) return 0

    const rawFee = (business as any).packagingFee
    const numFee = typeof rawFee === 'number' ? rawFee : parseFloat(String(rawFee || 0))
    const fee = !Number.isNaN(numFee) && numFee > 0 ? numFee : 0

    if (fee > 0) {
        console.log(`📦 [getPackagingFee] Tienda '${business.name || business.id || 'desconocida'}': hasPackagingFee=${hasFee}, fee=$${fee}`)
    }
    return fee
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

    if (commissionType === 'subscription' || commissionType === 'no_commission') {
        return {
            storePrice: safeStorePrice,
            commission: 0,
            publicPrice: safeStorePrice,
            commissionType,
            storeReceives: safeStorePrice
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
 * Calculates the public price of a product or variant based on its commission settings and packaging fee.
 * If commission is pending or not set, it returns the base price (+ packaging fee).
 * If commission is officialized, it returns the final public price (+ packaging fee).
 */
export function getProductPublicPrice(
    item: Partial<Product | ProductVariant>,
    packagingFeeOrBusiness?: number | Partial<Business> | null
): number {
    if (!item) return 0;
    if ((item as any).isCartItem || (item as any).feeAlreadyApplied) {
        const cartPrice = typeof item.price === 'number' ? item.price : 0;
        console.log(`🛒 [getProductPublicPrice] (Cart Item - Fee Already Applied) item='${(item as any).name || 'item'}' => $${cartPrice}`)
        return cartPrice;
    }

    const rawPrice = typeof item.price === 'number' ? item.price : 0;
    const basePrice = typeof item.basePrice === 'number' ? item.basePrice : undefined;

    let price = rawPrice;
    if (item.commissionType === 'no_commission' || item.commissionType === 'subscription' || !item.commissionType) {
        price = basePrice !== undefined ? basePrice : rawPrice;
    }

    let fee = 0;
    if (typeof packagingFeeOrBusiness === 'number') {
        fee = packagingFeeOrBusiness > 0 ? packagingFeeOrBusiness : 0;
    } else if (packagingFeeOrBusiness && typeof packagingFeeOrBusiness === 'object') {
        fee = getPackagingFee(packagingFeeOrBusiness);
    }
    
    if (fee <= 0 && item && (item as any).packagingFee !== undefined) {
        const rawFee = (item as any).packagingFee;
        const parsedFee = typeof rawFee === 'number' ? rawFee : parseFloat(String(rawFee || 0));
        if (!Number.isNaN(parsedFee) && parsedFee > 0) {
            fee = parsedFee;
        }
    }

    return price + fee;
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
export function getPriceMetadata(
    item: Partial<Product | ProductVariant>,
    packagingFeeOrBusiness?: number | Partial<Business> | null
) {
    if ((item as any).isCartItem || (item as any).feeAlreadyApplied) {
        const fee = typeof (item as any).packagingFee === 'number' ? (item as any).packagingFee : 0;
        const publicPrice = typeof item.price === 'number' ? item.price : 0;
        const commissionType = item.commissionType || 'no_commission';
        const commission = typeof item.commission === 'number' ? item.commission : 0;
        const basePrice = (item as any).basePrice ?? (publicPrice - commission);
        const storeReceives = (item as any).storeReceives ?? basePrice;
        return {
            basePrice,
            commission,
            publicPrice,
            commissionType,
            storeReceives,
            packagingFee: fee
        };
    }

    let fee = 0;
    if (typeof packagingFeeOrBusiness === 'number') {
        fee = packagingFeeOrBusiness > 0 ? packagingFeeOrBusiness : 0;
    } else if (packagingFeeOrBusiness && typeof packagingFeeOrBusiness === 'object') {
        fee = getPackagingFee(packagingFeeOrBusiness);
    }

    if (fee <= 0 && item && (item as any).packagingFee !== undefined) {
        const rawFee = (item as any).packagingFee;
        const parsedFee = typeof rawFee === 'number' ? rawFee : parseFloat(String(rawFee || 0));
        if (!Number.isNaN(parsedFee) && parsedFee > 0) {
            fee = parsedFee;
        }
    }

    const commissionType = item.commissionType || 'no_commission';
    const basePrice = typeof item.basePrice === 'number' ? item.basePrice : (typeof item.price === 'number' ? item.price : 0);
    const commission = (commissionType === 'no_commission' || commissionType === 'subscription') ? 0 : (typeof item.commission === 'number' ? item.commission : 0);

    // If no_commission or subscription, publicPrice = basePrice, otherwise use the 'price' field, plus packaging fee
    const publicPrice = ((commissionType === 'no_commission' || commissionType === 'subscription') ? basePrice : (typeof item.price === 'number' ? item.price : 0)) + fee;

    let storeReceives = basePrice + fee;
    if (commissionType === 'fuddi_assumed_by_store') {
        storeReceives = publicPrice - commission;
    }

    return {
        basePrice: basePrice + fee,
        commission,
        publicPrice,
        commissionType,
        storeReceives,
        packagingFee: fee
    };
}

// Central helper to ensure a cart/order item always contains price metadata
export function ensureCartItemMetadata(item: any, packagingFeeOrBusiness?: number | Partial<Business> | null): any {
  if (!item) return item
  if (item.isCartItem || item.feeAlreadyApplied) {
    return item
  }
  const meta = getPriceMetadata(item, packagingFeeOrBusiness)
  return {
    ...item,
    isCartItem: true,
    feeAlreadyApplied: true,
    basePrice: item.basePrice ?? meta.basePrice,
    commission: item.commission ?? meta.commission,
    commissionType: item.commissionType ?? meta.commissionType,
    storeReceives: item.storeReceives ?? meta.storeReceives,
    packagingFee: item.packagingFee ?? meta.packagingFee,
    publicPrice: item.publicPrice ?? meta.publicPrice,
    price: item.price ?? meta.publicPrice
  }
}
