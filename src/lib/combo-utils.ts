import { ProductVariant } from '@/types';

/**
 * Extrae la cantidad numérica inicial si la variante contiene algo como "5 wantancitos" o "3 Tequeños".
 * Utilizado como fallback en caso de que la variante no tenga ingredientes explícitos.
 */
export function parseVariantUnitCount(variantName: string): { multiplier: number; cleanName: string } {
  const matchLeading = variantName.match(/^(\d+)\s*(?:x|\*|\s)?\s*(.+)$/i);
  if (matchLeading) {
    return {
      multiplier: parseInt(matchLeading[1], 10),
      cleanName: matchLeading[2].trim()
    };
  }

  const matchParen = variantName.match(/^(.+?)\s*\(\s*(\d+)\s*(?:unid|unidades|uds|pcs)?\s*\)$/i);
  if (matchParen) {
    return {
      multiplier: parseInt(matchParen[2], 10),
      cleanName: matchParen[1].trim()
    };
  }

  return {
    multiplier: 1,
    cleanName: variantName.trim()
  };
}

/**
 * Formatea las variantes seleccionadas en un combo.
 * Si countComboUnits es true:
 * - Revisa si la variante tiene ingredientes configurados (`variant.ingredients`).
 * - Multiplica la cantidad seleccionada por la cantidad del ingrediente (o aplica fallback del nombre si no hay ingredientes).
 * Si countComboUnits es false:
 * - Formatea como "2x 5 wantancitos, 4x 3 Tequeños".
 */
export function formatComboVariantSelection(
  comboSelection: Record<string, number>,
  availableVariants?: ProductVariant[],
  countComboUnits?: boolean
): string {
  const selectedEntries = Object.entries(comboSelection).filter(([_, qty]) => qty > 0);
  if (selectedEntries.length === 0) return '';

  if (countComboUnits) {
    const formattedParts: string[] = [];

    for (const [variantName, qty] of selectedEntries) {
      const variant = availableVariants?.find(
        v => v.name.trim().toLowerCase() === variantName.trim().toLowerCase() || v.name === variantName
      );

      if (variant && variant.ingredients && variant.ingredients.length > 0) {
        // Usar los ingredientes definidos en la variante
        for (const ing of variant.ingredients) {
          const ingQty = Number(ing.quantity) || 1;
          const totalUnits = qty * ingQty;
          formattedParts.push(`${totalUnits} ${ing.name}`);
        }
      } else {
        // Fallback: parsear el nombre de la variante por si contiene un número (ej. "5 wantancitos")
        const { multiplier, cleanName } = parseVariantUnitCount(variantName);
        const totalUnits = qty * multiplier;
        formattedParts.push(`${totalUnits} ${cleanName}`);
      }
    }

    return formattedParts.join(', ');
  }

  // Formato tradicional
  return selectedEntries.map(([name, qty]) => `${qty}x ${name}`).join(', ');
}
