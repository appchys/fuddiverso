import { db } from './firebase';
import {
    collection,
    getDocs,
    doc,
    setDoc,
    serverTimestamp
} from 'firebase/firestore';

/**
 * Script para migrar ingredientes definidos en productos a la colección unificada de biblioteca de ingredientes.
 * Esto asegura que todos los ingredientes existentes estén disponibles en la biblioteca global del negocio
 * y en el panel de gestión de stock.
 */
export async function migrateProductIngredientsToLibrary(businessId: string) {
    console.log(`🚀 Iniciando migración de ingredientes para el negocio: ${businessId}`);

    try {
        // 1. Obtener todos los productos del negocio
        const productsSnapshot = await getDocs(collection(db, 'products'));
        const allProducts = productsSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as any))
            .filter(p => p.businessId === businessId);

        console.log(`📦 Encontrados ${allProducts.length} productos para este negocio.`);

        const unifiedIngredients = new Map<string, {
            name: string,
            unitCost: number,
            unit?: string
        }>();

        // 2. Extraer ingredientes únicos de productos y variantes
        allProducts.forEach((product: any) => {
            // Ingredientes del producto base
            if (product.ingredients && Array.isArray(product.ingredients)) {
                product.ingredients.forEach((ing: any) => {
                    const normName = ing.name.trim().toLowerCase();
                    if (!unifiedIngredients.has(normName) || (ing.unitCost > (unifiedIngredients.get(normName)?.unitCost || 0))) {
                        unifiedIngredients.set(normName, {
                            name: ing.name.trim(),
                            unitCost: ing.unitCost || 0,
                            unit: ing.unit || 'unidad'
                        });
                    }
                });
            }

            // Ingredientes de las variantes
            if (product.variants && Array.isArray(product.variants)) {
                product.variants.forEach((variant: any) => {
                    if (variant.ingredients && Array.isArray(variant.ingredients)) {
                        variant.ingredients.forEach((ing: any) => {
                            const normName = ing.name.trim().toLowerCase();
                            if (!unifiedIngredients.has(normName) || (ing.unitCost > (unifiedIngredients.get(normName)?.unitCost || 0))) {
                                unifiedIngredients.set(normName, {
                                    name: ing.name.trim(),
                                    unitCost: ing.unitCost || 0,
                                    unit: ing.unit || 'unidad'
                                });
                            }
                        });
                    }
                });
            }
        });

        console.log(`🔍 Encontrados ${unifiedIngredients.size} ingredientes únicos para migrar.`);

        // 3. Guardar en la biblioteca de ingredientes (businessIngredients)
        let migratedCount = 0;
        const entries = Array.from(unifiedIngredients.entries());
        for (const [normName, ingData] of entries) {
            // Generar ID consistente: ing_nombre_ingrediente
            const ingId = `ing_${normName.replace(/\s+/g, '_')}`;

            const libRef = doc(db, 'businesses', businessId, 'businessIngredients', ingId);

            await setDoc(libRef, {
                name: ingData.name,
                unitCost: ingData.unitCost,
                unit: ingData.unit,
                lastUsed: serverTimestamp(),
                usageCount: 1,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }, { merge: true });

            migratedCount++;
            console.log(`✅ Migrado: ${ingData.name}`);
        }

        console.log(`✨ Migración completada con éxito. ${migratedCount} ingredientes migrados.`);
        return { success: true, count: migratedCount };

    } catch (error) {
        console.error('❌ Error durante la migración:', error);
        return { success: false, error };
    }
}
