import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, updateDoc, doc, getDoc } from 'firebase/firestore'

// Configuración de Firebase directamente en el script para evitar problemas de importación de módulos TS
const firebaseConfig = {
    apiKey: "AIzaSyAAAFDJ_utlimCezUR-_i8Y2yUare9yZ1k",
    authDomain: "multitienda-69778.firebaseapp.com",
    projectId: "multitienda-69778",
    storageBucket: "multitienda-69778.firebasestorage.app",
    messagingSenderId: "939925630795",
    appId: "1:939925630795:web:713aca499392bfa36482ce"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/**
 * Genera un slug amigable para un producto basado en el username del negocio
 * y los primeros 3 caracteres del ID del producto.
 */
function generateProductSlug(businessUsername: string, productId: string): string {
    const storePrefix = (businessUsername || '').slice(0, 3).toLowerCase()
    const idPrefix = (productId || '').slice(0, 3)
    return `${storePrefix}${idPrefix}`
}

async function migrate() {
    console.log('🚀 Iniciando migración de slugs de productos...')

    try {
        const productsRef = collection(db, 'products')
        const snapshot = await getDocs(productsRef)

        console.log(`📦 Encontrados ${snapshot.size} productos.`)

        let updatedCount = 0
        let skippedCount = 0
        let errorCount = 0

        // Cache de negocios para evitar fetch repetitivo
        const businessCache: Record<string, string> = {}

        for (const productDoc of snapshot.docs) {
            const product = productDoc.data()
            const productId = productDoc.id

            if (product.slug) {
                console.log(`⏩ Saltando ${productId} (ya tiene slug: ${product.slug})`)
                skippedCount++
                continue
            }

            const businessId = product.businessId
            if (!businessId) {
                console.warn(`⚠️ Producto ${productId} no tiene businessId.`)
                errorCount++
                continue
            }

            let businessUsername = businessCache[businessId]
            if (!businessUsername) {
                const businessDoc = await getDoc(doc(db, 'businesses', businessId))
                if (businessDoc.exists()) {
                    businessUsername = businessDoc.data()?.username
                    if (businessUsername) {
                        businessCache[businessId] = businessUsername
                    }
                }
            }

            if (!businessUsername) {
                console.warn(`⚠️ No se pudo encontrar el username del negocio para el producto ${productId}.`)
                errorCount++
                continue
            }

            const slug = generateProductSlug(businessUsername, productId)

            await updateDoc(doc(db, 'products', productId), {
                slug: slug
            })

            console.log(`✅ Actualizado ${productId} -> ${slug}`)
            updatedCount++
        }

        console.log('\n--- Resumen de Migración ---')
        console.log(`✅ Actualizados: ${updatedCount}`)
        console.log(`⏩ Saltados: ${skippedCount}`)
        console.log(`❌ Errores: ${errorCount}`)
        console.log('---------------------------')

    } catch (error) {
        console.error('❌ Error durante la migración:', error)
    }
}

migrate().then(() => {
    console.log('👋 Migración finalizada.')
    process.exit(0)
}).catch(err => {
    console.error('❌ Error fatal:', err)
    process.exit(1)
})
