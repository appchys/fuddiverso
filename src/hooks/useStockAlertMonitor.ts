'use client'

import { useEffect, useRef } from 'react'
import { db } from '@/lib/firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { getProductsByBusiness, getIngredientStockSummary, createStockAlertNotification, IngredientStockSummary } from '@/lib/database'
import { evaluateProductStock, isProductEffectivelyAvailable } from '@/lib/stock-utils'

/**
 * Hook que monitorea en tiempo real los movimientos de stock del negocio
 * y dispara una notificación en la campana cuando un producto o variante pasa a estar agotado/oculto.
 */
export function useStockAlertMonitor(businessId?: string | null) {
  const previousStateRef = useRef<Map<string, boolean>>(new Map())
  const isInitializedRef = useRef<boolean>(false)
  const isCheckingRef = useRef<boolean>(false)

  useEffect(() => {
    if (!businessId) return

    let isMounted = true
    isInitializedRef.current = false
    previousStateRef.current.clear()

    const checkStockTransitions = async () => {
      if (isCheckingRef.current) return
      isCheckingRef.current = true

      try {
        const [products, stockSummaryData] = await Promise.all([
          getProductsByBusiness(businessId, true),
          getIngredientStockSummary(businessId)
        ])

        if (!isMounted) return

        const stockMap = new Map<string, IngredientStockSummary>()
        stockSummaryData.forEach(item => {
          if (item.ingredientName) {
            stockMap.set(item.ingredientName.toLowerCase().trim(), item)
          }
        })

        const currentState = new Map<string, boolean>()

        for (const product of products) {
          if (product.isAvailable === false) continue

          const evaluation = evaluateProductStock(product, stockMap)

          if (product.variants && product.variants.length > 0) {
            for (const variant of product.variants) {
              if (variant.isAvailable === false) continue

              const varKey = `var_${product.id}_${variant.name}`
              const isAvailable = evaluation.availableVariants.some(
                av => av.id === variant.id || av.name === variant.name
              )
              currentState.set(varKey, isAvailable)

              // Detectar si la variante SE ACABA de ocultar
              if (isInitializedRef.current) {
                const wasAvailable = previousStateRef.current.get(varKey)
                if (wasAvailable === true && isAvailable === false) {
                  const outOfStockIngs =
                    evaluation.outOfStockVariants.find(
                      ov => ov.variant.id === variant.id || ov.variant.name === variant.name
                    )?.outOfStockIngredients || []

                  void createStockAlertNotification(businessId, {
                    title: `Variante agotada por stock`,
                    message: `La variante "${variant.name}" del producto "${product.name}" se acaba de ocultar por falta de existencias${
                      outOfStockIngs.length > 0 ? ` (${outOfStockIngs.join(', ')})` : ''
                    }.`,
                    productId: product.id,
                    productName: product.name,
                    variantId: variant.id,
                    variantName: variant.name,
                    outOfStockIngredients: outOfStockIngs
                  })
                }
              }
            }

            // Monitorear producto completo con variantes
            const prodKey = `prod_${product.id}`
            const isProdAvailable = evaluation.isAvailableByStock
            currentState.set(prodKey, isProdAvailable)

            if (isInitializedRef.current) {
              const wasProdAvailable = previousStateRef.current.get(prodKey)
              if (wasProdAvailable === true && isProdAvailable === false) {
                void createStockAlertNotification(businessId, {
                  title: `Producto agotado por stock`,
                  message: `Todas las variantes de "${product.name}" se agotaron. El producto se acaba de ocultar de la tienda.`,
                  productId: product.id,
                  productName: product.name,
                  outOfStockIngredients: evaluation.outOfStockIngredients
                })
              }
            }
          } else {
            // Producto sin variantes
            const prodKey = `prod_${product.id}`
            const isProdAvailable = isProductEffectivelyAvailable(product, stockMap)
            currentState.set(prodKey, isProdAvailable)

            if (isInitializedRef.current) {
              const wasProdAvailable = previousStateRef.current.get(prodKey)
              if (wasProdAvailable === true && isProdAvailable === false) {
                void createStockAlertNotification(businessId, {
                  title: `Producto agotado por stock`,
                  message: `"${product.name}" se acaba de ocultar de la tienda por falta de stock.`,
                  productId: product.id,
                  productName: product.name,
                  outOfStockIngredients: evaluation.outOfStockIngredients
                })
              }
            }
          }
        }

        previousStateRef.current = currentState
        isInitializedRef.current = true
      } catch (err) {
        console.error('[useStockAlertMonitor] Error evaluando transiciones de stock:', err)
      } finally {
        isCheckingRef.current = false
      }
    }

    // Ejecutar verificación inicial silenciosa (para registrar estado previo)
    void checkStockTransitions()

    // Escuchar en tiempo real cambios en la biblioteca de ingredientes (donde ahora reside currentStock directo)
    const libraryRef = collection(db, 'businesses', businessId, 'ingredientLibrary')
    const unsubscribeLibrary = onSnapshot(
      libraryRef,
      () => {
        if (!isInitializedRef.current) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          void checkStockTransitions()
        }, 500)
      },
      (error) => {
        console.error('[useStockAlertMonitor] Error en listener de biblioteca:', error)
      }
    )

    // Escuchar también movimientos de stock del negocio (ventas, entradas, ajustes)
    const movementsRef = collection(db, 'ingredientStockMovements')
    const qMovements = query(movementsRef, where('businessId', '==', businessId))

    let debounceTimer: NodeJS.Timeout | null = null

    const unsubscribeMovements = onSnapshot(
      qMovements,
      () => {
        if (!isInitializedRef.current) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          void checkStockTransitions()
        }, 800)
      },
      (error) => {
        console.error('[useStockAlertMonitor] Error en listener de movimientos:', error)
      }
    )

    return () => {
      isMounted = false
      if (debounceTimer) clearTimeout(debounceTimer)
      unsubscribeLibrary()
      unsubscribeMovements()
    }
  }, [businessId])
}
