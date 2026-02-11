
// ==========================================
// Funciones para Liquidaciones (Settlements)
// ==========================================

import { Settlement } from '../types'
import { writeBatch } from 'firebase/firestore'

/**
 * Actualiza el estado de liquidación y/o el cobrador de una orden
 */
export async function updateOrderSettlementStatus(
    orderId: string,
    data: {
        paymentCollector?: 'fuddi' | 'store',
        settlementStatus?: 'pending' | 'settled',
        settlementId?: string
    }
) {
    try {
        const orderRef = doc(db, 'orders', orderId)
        await updateDoc(orderRef, data)
    } catch (error) {
        console.error('Error updating order settlement status:', error)
        throw error
    }
}

/**
 * Crea una nueva liquidación y actualiza todas las órdenes relacionadas en lote
 */
export async function createSettlement(
    settlementData: Omit<Settlement, 'id' | 'createdAt'>,
    orderIds: string[]
): Promise<string> {
    try {
        const batch = writeBatch(db)

        // 1. Crear documento de Settlement
        const settlementRef = doc(collection(db, 'settlements'))
        batch.set(settlementRef, {
            ...settlementData,
            createdAt: serverTimestamp()
        })

        // 2. Actualizar todas las órdenes
        orderIds.forEach(orderId => {
            const orderRef = doc(db, 'orders', orderId)
            batch.update(orderRef, {
                settlementStatus: 'settled',
                settlementId: settlementRef.id
            })
        })

        // 3. Ejecutar batch
        await batch.commit()

        return settlementRef.id
    } catch (error) {
        console.error('Error creating settlement:', error)
        throw error
    }
}

/**
 * Obtener liquidaciones de un negocio
 */
export async function getSettlementsByBusiness(businessId: string): Promise<Settlement[]> {
    try {
        const q = query(
            collection(db, 'settlements'),
            where('businessId', '==', businessId),
            orderBy('createdAt', 'desc')
        )
        const snapshot = await getDocs(q)
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: toSafeDate(doc.data().createdAt),
            startDate: toSafeDate(doc.data().startDate),
            endDate: toSafeDate(doc.data().endDate)
        })) as Settlement[]
    } catch (error) {
        console.error('Error getting settlements:', error)
        return []
    }
}
