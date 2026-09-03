import { Product, ProductVariant, Ingredient } from '@/types'
import { IngredientStockSummary } from '@/lib/database'

/**
 * Normaliza nombres de ingredientes para matching consistente
 */
export function normalizeIngredientName(name: string): string {
  return (name || '').toLowerCase().trim()
}

/**
 * Obtiene la lista de ingredientes que corresponden a una variante o producto base
 */
export function getIngredientsForVariant(
  product: Product,
  variant?: ProductVariant
): Ingredient[] {
  if (variant && variant.ingredients && variant.ingredients.length > 0) {
    return variant.ingredients
  }
  return product.ingredients || []
}

/**
 * Evalúa si una variante específica (o el producto base) tiene disponibilidad según sus ingredientes limitados
 */
export function checkVariantStockAvailability(
  product: Product,
  variant: ProductVariant | undefined,
  stockMap: Map<string, IngredientStockSummary>
): {
  isAvailableByStock: boolean
  hasLimitedIngredients: boolean
  outOfStockIngredients: string[]
  limitedIngredients: Array<{
    name: string
    requiredQty: number
    currentStock: number
    minStock: number
  }>
} {
  const ingredients = getIngredientsForVariant(product, variant)
  const limitedIngredients: Array<{
    name: string
    requiredQty: number
    currentStock: number
    minStock: number
  }> = []
  const outOfStockIngredients: string[] = []

  for (const ing of ingredients) {
    if (!ing.name) continue
    const itemStock = stockMap.get(normalizeIngredientName(ing.name))
    if (itemStock && itemStock.isStockLimited) {
      const min = itemStock.minStock ?? 0
      const current = itemStock.currentStock
      limitedIngredients.push({
        name: ing.name,
        requiredQty: Number(ing.quantity) || 1,
        currentStock: current,
        minStock: min
      })

      if (current <= min) {
        outOfStockIngredients.push(ing.name)
      }
    }
  }

  const hasLimitedIngredients = limitedIngredients.length > 0
  const isAvailableByStock = !hasLimitedIngredients || outOfStockIngredients.length === 0

  return {
    isAvailableByStock,
    hasLimitedIngredients,
    outOfStockIngredients,
    limitedIngredients
  }
}

export interface ProductStockEvaluation {
  isAvailableByStock: boolean
  hasLimitedIngredients: boolean
  outOfStockIngredients: string[]
  availableVariants: ProductVariant[]
  outOfStockVariants: Array<{
    variant: ProductVariant
    outOfStockIngredients: string[]
  }>
}

/**
 * Evalúa el stock completo de un producto y todas sus variantes/combos
 */
export function evaluateProductStock(
  product: Product,
  stockMap: Map<string, IngredientStockSummary>
): ProductStockEvaluation {
  const hasVariants = Boolean(product.variants && product.variants.length > 0)

  if (hasVariants && product.variants) {
    const availableVariants: ProductVariant[] = []
    const outOfStockVariants: Array<{
      variant: ProductVariant
      outOfStockIngredients: string[]
    }> = []
    const allOutOfStockIngs: string[] = []
    let hasAnyLimited = false

    for (const variant of product.variants) {
      const result = checkVariantStockAvailability(product, variant, stockMap)
      if (result.hasLimitedIngredients) {
        hasAnyLimited = true
      }

      // La variante se controla por stock si tiene autoHideByStock: true o si hereda product.autoHideByStock
      const isVariantAutoHide = variant.autoHideByStock !== undefined
        ? variant.autoHideByStock
        : (product.autoHideByStock ?? false)

      const isVariantInStock = isVariantAutoHide ? result.isAvailableByStock : true
      const isVariantEffectivelyAvailable = isVariantInStock && variant.isAvailable !== false

      if (isVariantEffectivelyAvailable) {
        availableVariants.push(variant)
      } else {
        outOfStockVariants.push({
          variant,
          outOfStockIngredients: result.outOfStockIngredients
        })
        if (!result.isAvailableByStock) {
          allOutOfStockIngs.push(...result.outOfStockIngredients)
        }
      }
    }

    // Para combos: si es combo y se requiere un mínimo de opciones (minComboItems),
    // el combo solo está disponible si hay al menos minComboItems variantes disponibles
    const minRequired = product.isCombo ? (product.minComboItems || 1) : 1
    const isAvailableByStock = availableVariants.length >= (product.isCombo ? minRequired : 1)

    return {
      isAvailableByStock,
      hasLimitedIngredients: hasAnyLimited,
      outOfStockIngredients: Array.from(new Set(allOutOfStockIngs)),
      availableVariants,
      outOfStockVariants
    }
  }

  // Producto sin variantes
  const result = checkVariantStockAvailability(product, undefined, stockMap)
  return {
    isAvailableByStock: result.isAvailableByStock,
    hasLimitedIngredients: result.hasLimitedIngredients,
    outOfStockIngredients: result.outOfStockIngredients,
    availableVariants: [],
    outOfStockVariants: []
  }
}

/**
 * Determina si un producto debe estar visible considerando su configuración autoHideByStock
 */
export function isProductEffectivelyAvailable(
  product: Product,
  stockMap: Map<string, IngredientStockSummary>
): boolean {
  if (product.isAvailable === false) return false
  if (product.autoHideByStock) {
    const evaluation = evaluateProductStock(product, stockMap)
    return evaluation.isAvailableByStock
  }
  return true
}

/**
 * Determina si un ítem en el carrito está efectivamente disponible (combinando disponibilidad manual y control por stock)
 */
export function isCartItemEffectivelyAvailable(
  item: any,
  allProducts: Product[],
  stockMap?: Map<string, IngredientStockSummary>
): boolean {
  if (!item) return false
  if (item.esPremio || item.qrCodeId) return true
  if (!allProducts || allProducts.length === 0) return true // Si aún no han cargado productos de la BD, no bloquear preventivamente

  const rawId = item.productId || item.id || ''
  const baseId = typeof rawId === 'string' && rawId.includes('-') ? rawId.split('-')[0] : rawId

  const dbProduct = allProducts.find(p => p.id === (item.productId || item.id))
    ?? allProducts.find(p => typeof item.id === 'string' && item.id.startsWith(p.id + '-'))
    ?? allProducts.find(p => p.id === baseId)

  if (!dbProduct) return false
  if (dbProduct.isAvailable === false) return false

  // Evaluar variantes
  if (item.variantName && !item.variantName.startsWith('Combo:')) {
    const variant = dbProduct.variants?.find(v => v.name === item.variantName)
    if (!variant || variant.isAvailable === false) return false

    if (stockMap && stockMap.size > 0) {
      const isVariantAutoHide = variant.autoHideByStock !== undefined
        ? variant.autoHideByStock
        : (dbProduct.autoHideByStock ?? false)

      if (isVariantAutoHide) {
        const variantStock = checkVariantStockAvailability(dbProduct, variant, stockMap)
        if (!variantStock.isAvailableByStock) return false
      }
    }
    return true
  }

  // Evaluar producto base o combo
  if (stockMap && stockMap.size > 0 && dbProduct.autoHideByStock) {
    const evaluation = evaluateProductStock(dbProduct, stockMap)
    if (!evaluation.isAvailableByStock) return false
  }

  return true
}

/**
 * Extrae el nombre base de la variante limpiando opciones o modificadores entre paréntesis.
 * Ej: "Grande (Salsas: Ajo, Picante)" -> "Grande"
 */
export function extractBaseVariantName(variantStr?: string | null): string {
  if (!variantStr || typeof variantStr !== 'string') return ''
  const trimmed = variantStr.trim()
  if (trimmed.startsWith('Combo:')) return ''
  const match = trimmed.match(/^([^(]+)\s*\(/)
  if (match && match[1]) {
    return match[1].trim()
  }
  return trimmed
}

/**
 * Resuelve la lista de ingredientes correspondientes a un ítem de orden o carrito.
 * Prioridad:
 * 1. Si el ítem ya trae ingredientes resueltos en su snapshot (item.ingredients > 0), los usa.
 * 2. Si es combo y tiene comboSelection, desglosa los ingredientes de cada variante multiplicados por su respectiva cantidad en la selección.
 * 3. Si tiene variante (o variantName / variantId), busca en product.variants (por nombre exacto, ID o nombre base) y extrae sus ingredientes.
 * 4. Fallback a ingredientes del producto base (product.ingredients).
 */
export function resolveItemIngredients(
  item: any,
  product?: Product,
  rewardSettings?: { ingredients?: Ingredient[] }
): Ingredient[] {
  if (!item) return []

  // 1. Snapshot directo en el ítem (si ya fue resuelto previamente)
  if (Array.isArray(item.ingredients) && item.ingredients.length > 0) {
    return item.ingredients
  }

  // 1.1 Si es el premio automático especial o un premio y se provee rewardSettings
  const isPremioAuto = item.id === 'premio-especial-auto' || item.productId === 'premio-especial-auto' || item.esPremio
  if (isPremioAuto) {
    if (rewardSettings?.ingredients && Array.isArray(rewardSettings.ingredients) && rewardSettings.ingredients.length > 0) {
      return rewardSettings.ingredients
    }
    if (item.rewardSettings?.ingredients && Array.isArray(item.rewardSettings.ingredients) && item.rewardSettings.ingredients.length > 0) {
      return item.rewardSettings.ingredients
    }
  }

  if (!product) return []

  // 2. Combo con desglose en comboSelection
  const comboSelection = item.comboSelection || (item.product && (item.product as any).comboSelection)
  if (comboSelection && typeof comboSelection === 'object' && product.variants && Array.isArray(product.variants)) {
    const comboIngs: Ingredient[] = []
    Object.entries(comboSelection).forEach(([variantKey, selQty]) => {
      const count = Number(selQty) || 0
      if (count > 0) {
        const variantObj = product.variants?.find((v: any) =>
          v.name === variantKey || v.id === variantKey || extractBaseVariantName(v.name) === variantKey
        )
        if (variantObj?.ingredients && Array.isArray(variantObj.ingredients)) {
          variantObj.ingredients.forEach(ing => {
            if (!ing || !ing.name) return
            comboIngs.push({
              ...ing,
              quantity: (Number(ing.quantity) || 1) * count
            })
          })
        }
      }
    })
    if (comboIngs.length > 0) {
      return comboIngs
    }
  }

  // 3. Variante individual
  const rawVariant = typeof item.variant === 'string'
    ? item.variant
    : (item.variant?.name || item.variantName || '')

  const variantId = item.variantId || (typeof item.variant === 'object' ? item.variant?.id : undefined)

  if ((rawVariant || variantId) && product.variants && Array.isArray(product.variants)) {
    const baseVariantName = extractBaseVariantName(rawVariant)
    const variantObj = product.variants.find((v: any) =>
      (variantId && v.id === variantId) ||
      (rawVariant && v.name === rawVariant) ||
      (baseVariantName && v.name === baseVariantName) ||
      (baseVariantName && extractBaseVariantName(v.name) === baseVariantName)
    )

    if (variantObj?.ingredients && Array.isArray(variantObj.ingredients) && variantObj.ingredients.length > 0) {
      return variantObj.ingredients
    }
  }

  // 4. Ingredientes del producto base
  if (product.ingredients && Array.isArray(product.ingredients) && product.ingredients.length > 0) {
    return product.ingredients
  }

  return []
}
