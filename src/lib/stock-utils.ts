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
  if (product.autoHideByStock) {
    const evaluation = evaluateProductStock(product, stockMap)
    return evaluation.isAvailableByStock
  }
  return product.isAvailable !== false
}
