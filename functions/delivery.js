const admin = require('firebase-admin');

/**
 * Función auxiliar para procesar la acción de la orden (reutilizada por Email y Telegram)
 */
async function processOrderAction(token, action) {
    try {
        // Decodificar token
        let orderId, actionType;
        try {
            const decoded = Buffer.from(token, 'base64').toString('utf-8');
            [orderId, actionType] = decoded.split('|');
        } catch (e) {
            return { error: 'Token inválido' };
        }

        // Validar que el action sea válido
        if (!['confirm', 'discard', 'on_way', 'delivered'].includes(action) || actionType !== action) {
            return { error: 'Acción inválida' };
        }

        // Obtener la orden
        const orderDoc = await admin.firestore().collection('orders').doc(orderId).get();
        if (!orderDoc.exists) {
            return { error: 'Orden no encontrada' };
        }

        const order = orderDoc.data();

        // No permitir cambios si ya está entregada o cancelada (excepto si la acción es informativa)
        if (order.status === 'delivered' || order.status === 'cancelled') {
            return { orderId };
        }

        // Actualizar estado según la acción
        const updateData = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (action === 'confirm') {
            updateData.status = 'preparing';
            updateData['delivery.acceptanceStatus'] = 'accepted';
            console.log(`✅ Orden ${orderId} confirmada por delivery`);
        } else if (action === 'on_way') {
            updateData.status = 'on_way';
            updateData['statusHistory.onWayAt'] = admin.firestore.FieldValue.serverTimestamp();
            console.log(`🛵 Orden ${orderId} en camino`);
        } else if (action === 'delivered') {
            updateData.status = 'delivered';
            updateData.deliveredAt = admin.firestore.FieldValue.serverTimestamp();
            updateData['statusHistory.deliveredAt'] = admin.firestore.FieldValue.serverTimestamp();
            console.log(`✅ Orden ${orderId} marcada como entregada`);
        } else if (action === 'discard') {
            const currentDeliveryId = order.delivery?.assignedDelivery;

            updateData['delivery.assignedDelivery'] = null;

            if (currentDeliveryId) {
                updateData['delivery.rejectedBy'] = admin.firestore.FieldValue.arrayUnion(currentDeliveryId);
            }

            console.log(`❌ Orden ${orderId} descartada por delivery ${currentDeliveryId || 'desconocido'}. Pedido liberado.`);
        }

        // Actualizar la orden
        await orderDoc.ref.update(updateData);

        return { orderId };
    } catch (error) {
        console.error('Error en processOrderAction:', error);
        return { error: 'Error interno' };
    }
}

/**
 * HTTP Function: Manejar acciones de confirmación/descarte de orden por parte del delivery
 * Accesible desde los links en el email
 */
async function handleDeliveryOrderAction(request, response) {
    // Configurar CORS
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        response.status(204).send('');
        return;
    }

    try {
        const { action, token } = request.query;

        if (!action || !token) {
            return response.status(400).json({ error: 'Parámetros faltantes' });
        }

        // Decodificar token
        const result = await processOrderAction(token, action);

        if (result.error) {
            return response.status(400).json({ error: result.error });
        }

        // Redirección directa al dashboard con parámetros para mostrar notificación
        const redirectUrl = `https://fuddi.shop/delivery/dashboard?action=${action}&orderId=${result.orderId.substring(0, 8).toUpperCase()}`;
        response.redirect(redirectUrl);

    } catch (error) {
        console.error('❌ Error en handleDeliveryOrderAction:', error);
        response.status(500).json({ error: 'Error procesando la acción' });
    }
}

module.exports = {
    processOrderAction,
    handleDeliveryOrderAction
};
